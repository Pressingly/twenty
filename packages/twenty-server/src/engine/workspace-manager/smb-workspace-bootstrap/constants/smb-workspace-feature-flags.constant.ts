import { FeatureFlagKey } from 'twenty-shared/types';

import { DEFAULT_FEATURE_FLAGS } from 'src/engine/workspace-manager/workspace-migration/constant/default-feature-flags';

// Keeps new SMB workspaces on the same product features as the ones created
// by the old dev-seed bootstrap, on top of upstream's sign-up defaults.
export const SMB_WORKSPACE_FEATURE_FLAGS = [
  ...DEFAULT_FEATURE_FLAGS,
  FeatureFlagKey.IS_RECORD_CREATION_FORM_ENABLED,
  FeatureFlagKey.IS_CALENDAR_EVENT_SHARED_ACROSS_CHANNELS_ENABLED,
  FeatureFlagKey.IS_AI_CHAT_INBOX_ENABLED,
  FeatureFlagKey.IS_MCP_SERVERS_ENABLED,
] as const satisfies FeatureFlagKey[];
