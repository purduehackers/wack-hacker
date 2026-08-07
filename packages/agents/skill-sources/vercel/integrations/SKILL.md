---
name: integrations
description: Browse installed integrations, provision new marketplace stores (Turso, Upstash Redis, Neon Postgres, Vercel Blob), and connect them to projects.
criteria: Use when the user asks about marketplace integrations, provisioning a new database/KV/blob store, attaching a provisioned store to a project, rotating integration secrets, or searching git repos for a new project.
tools:
  [
    list_integration_configurations,
    get_integration_configuration,
    get_integration_configuration_products,
    get_integration_billing_plans,
    delete_integration_configuration,
    create_integration_store_direct,
    connect_integration_resource_to_project,
    list_integration_resources,
    get_integration_resource,
    delete_integration_resource,
    list_git_namespaces,
    search_git_repos,
  ]
minRole: organizer
mode: inline
---

<provisioning-flow>
The standard flow to create a new store (e.g. Turso database, Upstash Redis):

1. Call `list_integration_configurations` with `view: "account"` to find the installed integration (Turso, Upstash, Neon, etc.) and its configuration id.
2. Call `get_integration_configuration_products` with the configuration id to list products (e.g. `database`, `kv`, `blob`).
3. Call `get_integration_billing_plans` with the integration slug and product slug to see pricing. **Confirm with the user before a paid plan.**
4. Call `create_integration_store_direct` with the configuration id, product slug, and a name. Returns a resource id.
5. Call `connect_integration_resource_to_project` with the resource id + project id. Env vars auto-populate on the project; **a fresh deployment is required for them to take effect.**
   </provisioning-flow>

<deletion>
- `delete_integration_resource` **destroys the underlying store** (drops the Turso DB, etc.). Data is unrecoverable.
- `delete_integration_configuration` uninstalls an integration. Resources may detach.
</deletion>

<git>
- `search_git_repos` helps locate a GitHub/GitLab/Bitbucket repo for a new project. `list_git_namespaces` gives the org list.
</git>
