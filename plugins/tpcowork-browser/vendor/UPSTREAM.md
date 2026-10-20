# Upstream and local modifications

TPCowork is derived from [ZCode](https://github.com/zai-org/ZCode). The current upstream baseline is tag `v3.15.1`, commit `aac4755666d09fdcd70272fcf063c077a639015f`, synchronized on 2026-10-13. The initial fork used commit `872ad960de7ec172591f7e1952f7849229f94521` (version 3.14.0).

The 3.15.1 update incorporates upstream source, dependencies, workflows, MCP Apps / Gen UI, runtime and remote-control changes while preserving TPCowork naming, provider integration, the local plugin service and catalog rules, retired purchase entries, and development-only motion suppression. Scope, ownership, compatibility and validation are recorded in [doc/upstream-3.15.1-sync-spec.md](doc/upstream-3.15.1-sync-spec.md). The CLI retains its independently versioned upstream release, 0.16.9.

The initial TPCowork changes, dated 2026-09-21, rename first-party product labels, source paths, package namespaces, internal identifiers, command names, configuration prefixes and build artifacts. TPCowork application artwork replaces the original product artwork. Runtime architecture is retained. Product-specific backend integration is documented in `doc/backend-migration.md` and is not claimed to be implemented by this rename.

Initial modified source files carry a TPCowork modification notice where their format supports comments. Initial structured files and asset changes are recorded in `doc/rebranding-files.json` with source and destination paths and content hashes; this initial-fork record remains unchanged. The 3.15.1 synchronization preserves external service and published page-protocol identifiers, including sandbox `window.zcode`, Gen UI page methods and MCP Apps experimental keys. The first-party desktop bridge remains `window.tpcowork`.

The original Apache-2.0 `LICENSE`, upstream `NOTICE.md`, third-party license texts and applicable attribution notices remain part of this distribution. Preserved upstream names in external service URLs, OAuth registration identifiers and published protocol keys identify their actual owners and compatibility contracts. They do not identify TPCowork-owned services. Upstream trademarks are not licensed by the code license.

The original source repository and the previous nanobot-gui repository are not modified by this fork.
