import { type McpToolAnnotations } from 'src/engine/api/mcp/types/mcp-tool-annotations.type';

// Fork: flagged destructive so MCP clients (Askii) confirm every Twenty write before running it (FOSS-594)
export const MCP_EXECUTE_TOOL_ANNOTATIONS: McpToolAnnotations = {
  readOnlyHint: false,
  openWorldHint: true,
  destructiveHint: true,
};
