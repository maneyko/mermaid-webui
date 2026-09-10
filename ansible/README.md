# maneyko.mermaid_webui

The role that deploys this repo onto a host: bun, a clone at `/opt/mermaid-webui`, `bun run
build`, and the NGINX site that serves `dist/`.

There is no service and no application user. The bundle is static files, so NGINX is the only
thing that runs it, and `www-data` is the only account that needs to read it.

## Two ways in

| Block | Listens on | `server_name` |
|---|---|---|
| tunnel | `127.0.0.1:8080` | none; it is the only listener on that port |
| public | `:443` via `default-cert.conf` | from `snippets/mermaid-webui.local.conf` |

Cloudflare Access is enforced at Cloudflare's edge and nowhere else, so it only covers
requests that arrive through it. Everything reaching the loopback block does, because there
is no other route to it. The public block answers this host directly, so it does not.

The two blocks must not share a name. One block listening on both addresses would serve the
tunnel's name publicly as well, and that name's Access policy would become decoration.

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

`secrets.nginx.local_conf` is where this host's own NGINX configuration goes. It must carry
the public block's `server_name`, and it is written to `/etc/nginx/snippets/` rather than into
the checkout, because what this host answers to is the caller's business and the repo does not
ignore that path.

`mermaid_webui_repo` in `roles/deploy/vars/main.yaml` is an SSH URL, so the play needs agent
forwarding (`ansible_ssh_extra_args: "-A"`) and `SSH_AUTH_SOCK` kept across `sudo`. Override it
with an HTTPS URL to drop both requirements.

## What the role does, in order

1. Installs `maneyko.roles.bun` with `config.owner` in the bun group.
2. Clones the repo to `/opt/mermaid-webui` at `config.version`, defaulting to `main`.
3. Hands the checkout to `config.owner:www-data`, directories `2750`, files `g-w,o=`.
4. Links `/usr/local/libexec/mermaid-webui/node` at the bun binary.
5. `bun install --frozen-lockfile`, then `bun run build`.
6. Links the vhost into `sites-enabled`, writes the secret snippet, reloads NGINX.

## node

`node_modules/.bin/tsc` and `.../vite` are both `#!/usr/bin/env node`, and this host has no
node. bun runs node's entry points when it is invoked under that name — the same trick
`maneyko.roles.bun` uses for `bunx` — so step 4 makes a `node` that is bun, and step 5 puts
that one directory on `PATH`. Nothing else on the host finds a `node`, which is correct:
bun is not node, and only this build is asking it to pretend.

`bun --bun run build` is the documented way to ask for the same thing and is what you would
reach for by hand. It works interactively and silently does nothing for root, so it is not
what the role uses. Which matters, because:

**The build very likely runs as root, not as `config.owner`.** `ansible_become_user` is a
connection variable, so an inventory that pins it — `google-setup`'s does, to `root` — outranks
the `become_user` keyword on the task, and Ansible escalates to root without saying so. The
shared bun cache survives this because `maneyko.roles.bun` creates it `g+srw` and its shim sets
`umask 0002`, so a root-written entry stays group-writable; and the next apply's `chown -R`
puts the checkout back. Getting it to genuinely run as `config.owner` needs the `acl` package
on the host, which is not installed.

## Ownership

`/opt/mermaid-webui` is `config.owner:www-data`, directories `2750` and files `g-w,o=`, so
NGINX reads `dist/` through the group and nothing outside it reads the checkout at all.

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
