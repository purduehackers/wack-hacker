# `notion`

The Purdue Hackers Notion workspace: pages, databases, blocks, and comments,
through a single integration token.

Notion is a document store with a schema bolted on, so the same object answers
to two vocabularies. A "doc" is a page; a "table" is a database; a "row" is a
page inside one; a "column" is a property. Under the v5 API a database is only a
container — the schema and the rows live on a data source beneath it — so
`retrieve_database` resolves that child and reads its schema before anything
else can filter on it. Page bodies are read and written as Notion-flavored
markdown; the block tools exist for the cases markdown cannot express.

It does not own the public website. Anything that renders on
purduehackers.com goes through the `cms` subagent's Payload collections, not a
Notion page. It does not own the CRM either: the **Companies**, **Contacts** and
**Deals** data sources belong to `outreach`, which enforces Do Not Contact and
records sends. These tools can write those rows and will not do any of that
bookkeeping.

The integration only sees pages a human explicitly shared with it. An empty
`search_notion` result means "not shared", as often as it means "does not
exist", and the two are indistinguishable from here.

## Sharp edges

`update_database` deletes a property when its value is set to null, and that
takes every value in that column, on every row, with it. Notion's trash holds
archived pages and databases; it does not hold a deleted property.

Everything else destructive here is soft. `archive_page`, `archive_database`
and `delete_block` set the trash flag rather than removing anything, and a human
can restore them from the Notion UI — the tools say "delete" because users do.
The recoverable-but-unpleasant pair is `update_block`, which replaces a block's
content rather than merging into it, and `update_page_content` in
`replace_content` mode, which does the same to an entire page body. Read the
current state first: `retrieve_block` before the one, `read_page_content`
before the other.

<!-- generated: do not edit below this line -->

## Surface

**24 tools** across **4 skills**, plus 4 always-available.

## Skills

| Skill                              | Role      | Tools | Description                                                                                      |
| ---------------------------------- | --------- | ----: | ------------------------------------------------------------------------------------------------ |
| [`blocks`](skills/blocks.md)       | organizer |     5 | Read and modify individual Notion blocks — retrieve, update, archive, list children, and append. |
| [`comments`](skills/comments.md)   | organizer |     3 | Create and list comments on pages and blocks.                                                    |
| [`databases`](skills/databases.md) | organizer |     4 | Query database entries with filters/sorts; create and update databases.                          |
| [`pages`](skills/pages.md)         | organizer |     8 | Create, update, read, and edit pages — properties and Notion-flavored markdown content.          |

## Always available

Reachable without loading a skill.

| Tool                | Risk | Role   | What it does                                                                                                 |
| ------------------- | ---- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `list_users`        | read | public | List workspace users.                                                                                        |
| `retrieve_database` | read | public | Get a database's schema — title, property definitions (types, options), and URL.                             |
| `retrieve_page`     | read | public | Get a page's properties and metadata — title, URL, parent, timestamps, icon, cover, and all property values. |
| `search_notion`     | read | public | Search the Notion workspace by keyword.                                                                      |

## `blocks`

Read and modify individual Notion blocks — retrieve, update, archive, list children, and append.

| Tool                    | Risk        | Role      | What it does                                                 |
| ----------------------- | ----------- | --------- | ------------------------------------------------------------ |
| `append_block_children` | write       | organizer | Append blocks to a page or container block.                  |
| `delete_block`          | destructive | organizer | Archive (soft-delete) a block.                               |
| `list_block_children`   | read        | public    | List a block's child blocks (for a page or container block). |
| `retrieve_block`        | read        | public    | Get a single Notion block by ID.                             |
| `update_block`          | destructive | organizer | Update a block's content.                                    |

## `comments`

Create and list comments on pages and blocks.

| Tool               | Risk  | Role      | What it does                                                       |
| ------------------ | ----- | --------- | ------------------------------------------------------------------ |
| `create_comment`   | write | organizer | Add a comment to a page or reply in an existing discussion thread. |
| `list_comments`    | read  | public    | List comments on a page.                                           |
| `retrieve_comment` | read  | public    | Get a single Notion comment by ID.                                 |

## `databases`

Query database entries with filters/sorts; create and update databases.

| Tool               | Risk        | Role      | What it does                                      |
| ------------------ | ----------- | --------- | ------------------------------------------------- |
| `archive_database` | destructive | organizer | Archive (soft-delete) a Notion database.          |
| `create_database`  | write       | organizer | Create a new database as a child of a page.       |
| `query_database`   | read        | public    | Query a database with optional filters and sorts. |
| `update_database`  | write       | organizer | Update a database's title or property schema.     |

## `pages`

Create, update, read, and edit pages — properties and Notion-flavored markdown content.

| Tool                     | Risk        | Role      | What it does                                                                                                           |
| ------------------------ | ----------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `archive_page`           | destructive | organizer | Archive (soft-delete) a Notion page.                                                                                   |
| `create_page`            | write       | organizer | Create a new Notion page.                                                                                              |
| `read_page_content`      | read        | public    | Read a page's full body content as markdown.                                                                           |
| `retrieve_bot_user`      | read        | public    | Get info about the bot user backing this integration — useful for confirming which workspace and user the integration… |
| `retrieve_page_property` | read        | public    | Get a single property value from a page, with pagination for large values (relations, rollups, rich_text).             |
| `retrieve_user`          | read        | public    | Get a single Notion user by ID.                                                                                        |
| `update_page`            | destructive | organizer | Update a page's properties, icon, cover, or archived status.                                                           |
| `update_page_content`    | write       | organizer | Update a page's body content using markdown.                                                                           |
