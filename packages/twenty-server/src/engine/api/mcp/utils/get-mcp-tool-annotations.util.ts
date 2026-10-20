import { MCP_READ_ONLY_TOOL_NAMES } from 'src/engine/api/mcp/constants/mcp-read-only-tool-names.const';

export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
};

const READ_ONLY_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
};

const DESTRUCTIVE_WRITE_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
};

export const getMcpToolAnnotations = (toolName: string): McpToolAnnotations =>
  MCP_READ_ONLY_TOOL_NAMES.has(toolName)
    ? { ...READ_ONLY_ANNOTATIONS }
    : { ...DESTRUCTIVE_WRITE_ANNOTATIONS };
