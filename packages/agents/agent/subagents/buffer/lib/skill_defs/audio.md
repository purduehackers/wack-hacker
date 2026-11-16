---
description: Buffer audio: instagramAudio, instagramAudioCatalog, searchInstagramAudio, searchInstagramAudioCatalog, trendingInstagramAudio.
---

Use the typed audio operations. Their arguments match Buffer's public GraphQL schema. All reads and ordinary writes require organizer access; deletions require admin access. Preview and experimental features may be unavailable for the current account.

Use selection to include extra response fields. Keep maxPages bounded and inspect complete/pageInfo before claiming a full result. Mutations return success or typed errors; HTTP acceptance does not mean publication. Never repeat an uncertain mutation without checking affected resources. Use exportDataset when the root agent needs data for a chart.

Only perform writes requested by the user. Check allowedActions and channel capabilities. Preserve upstream omitted-versus-null semantics and never substitute an unsupported operation with a different write.
