# maneyko.mermaid_webui

The role that deploys this repo onto a host: bun, a clone at `/opt/mermaid-webui`, `bun run
build`, and the NGINX site that serves `dist/`.

There is no service and no application user. The bundle is static files, so NGINX is the only
thing that runs it, and `www-data` is the only account that needs to read it.

`requirements.yml`:

```yaml
collections:
  - name: git@github.com:maneyko/ansible-roles.git
    type: git
    version: main
  - name: git@github.com:maneyko/mermaid-webui.git#/ansible
    type: git
    version: main
```

The `#/ansible` fragment is the subdirectory the collection lives in — this repo is an
application that happens to ship its own deploy role, not a collection repo. `maneyko.roles` is
listed because this role installs bun through `maneyko.roles.bun`; it is not a `galaxy.yml`
dependency, because that would send `ansible-galaxy` to the public Galaxy server looking for a
collection that only exists in a private git repo.

```yaml
- hosts: all
  roles:
    - role: maneyko.mermaid_webui.deploy
      vars:
        config:  "{{ app_config }}"
        secrets: "{{ app_secrets }}"
```

`config` and `secrets` are declared in `roles/deploy/meta/argument_specs.yaml` and validated
before the role runs:

    ansible-doc -t role maneyko.mermaid_webui.deploy   # collection installed
    ansible-doc -t role -r roles deploy                # from this repo

`secrets.nginx.local_conf` is the whole of the secret: it carries `server_name`, and it is
written to `/etc/nginx/snippets/` rather than into the checkout. The site includes
`snippets/default-cert.conf` for its certificate, so `maneyko.roles.nginx_common` must have run
on the host and that certificate must cover the name.

`mermaid_webui_repo` in `roles/deploy/vars/main.yaml` is an SSH URL, so the play needs agent
forwarding (`ansible_ssh_extra_args: "-A"`) and `SSH_AUTH_SOCK` kept across `sudo`. Override it
with an HTTPS URL to drop both requirements.

## What the role does, in order

1. Installs `maneyko.roles.bun` with `config.owner` in the bun group.
2. Clones the repo to `/opt/mermaid-webui` at `config.version`, defaulting to `main`.
3. Hands the checkout to `config.owner:www-data`, directories `2750`, files `g-w,o=`.
4. `bun install --frozen-lockfile`, then `bun --bun run build`, both as `config.owner`.
5. Links the vhost into `sites-enabled`, writes the secret snippet, reloads NGINX.

## Ownership

| | Owner | |
|---|---|---|
| `/opt/mermaid-webui` | `config.owner:www-data`, `2750` / `g-w,o=` | NGINX reads `dist/` through the group |
| `/etc/nginx/snippets/mermaid-webui.local.conf` | `root:www-data`, `0640` | `server_name`, out of the checkout |

Step 3 runs *before* step 4, so `node_modules/` and `dist/` are not swept until the next apply.
That is fine rather than latent: `/opt/mermaid-webui` is setgid, both directories inherit group
`www-data`, and the bun shim's `umask 0002` leaves files group-readable — so NGINX serves a
first run.

That is also why `maneyko.roles.bun` sets `BUN_OPTIONS=--backend=copyfile`. bun otherwise
hardlinks cache entries into `node_modules`, and a hardlink's owner and mode *are* the cache
entry's — step 3 would rewrite the shared cache for every other member of the bun group. Read
the shared-toolchain section of `ansible-roles/README.md` before changing that.

`bun install` is `--frozen-lockfile` because `bun.lock` is in the repo. A host that resolves
anything else is serving a bundle no checkout of that commit reproduces, and a stale lockfile
should fail the deploy rather than quietly change what is shipped.
