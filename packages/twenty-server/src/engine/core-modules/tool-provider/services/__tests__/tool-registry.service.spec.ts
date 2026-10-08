import { ToolCategory } from 'twenty-shared/ai';
import { type ActorMetadata, FieldActorSource } from 'twenty-shared/types';

import { type ToolProvider } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider.interface';

import { type ToolExecutorService } from 'src/engine/core-modules/tool-provider/services/tool-executor.service';
import { ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import { type ToolDescriptor } from 'src/engine/core-modules/tool-provider/types/tool-descriptor.type';
import { type ToolContext } from 'src/engine/core-modules/tool-provider/types/tool-context.type';

describe('ToolRegistryService', () => {
  const actorContext: ActorMetadata = {
    source: FieldActorSource.AGENT,
    workspaceMemberId: 'workspace-member-1',
    name: 'Jane Doe',
    context: {},
  };

  const toolContext: ToolContext = {
    workspaceId: 'workspace-1',
    roleId: 'role-1',
    userId: 'user-1',
    userWorkspaceId: 'user-workspace-1',
    actorContext,
  };

  const createCompanyDescriptor: ToolDescriptor = {
    name: 'create_company',
    description: 'Create a company',
    category: ToolCategory.DATABASE_CRUD,
    executionRef: {
      kind: 'database_crud',
      objectNameSingular: 'company',
      operation: 'create',
    },
    inputSchema: { type: 'object', properties: {} },
  };

  const buildProvider = (): ToolProvider => ({
    category: ToolCategory.DATABASE_CRUD,
    isAvailable: jest.fn().mockResolvedValue(true),
    generateDescriptors: jest.fn().mockResolvedValue([createCompanyDescriptor]),
    executeStaticTool: jest.fn(),
  });

  let dispatch: jest.Mock;
  let service: ToolRegistryService;

  beforeEach(() => {
    dispatch = jest.fn().mockResolvedValue({ success: true, message: 'ok' });
    service = new ToolRegistryService([buildProvider()], {
      dispatch,
    } as unknown as ToolExecutorService);
  });

  it('should forward actorContext to the executor from resolveAndExecute', async () => {
    await service.resolveAndExecute(
      'create_company',
      { name: 'Acme' },
      toolContext,
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'create_company' }),
      { name: 'Acme' },
      expect.objectContaining({ actorContext }),
    );
  });

  it('should forward actorContext to the executor from tools built by getToolsByName', async () => {
    const toolSet = await service.getToolsByName(
      ['create_company'],
      toolContext,
      { includeLoadingMessage: false },
    );

    await toolSet.create_company.execute?.(
      { name: 'Acme' },
      { toolCallId: 'call-1', messages: [] },
    );

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'create_company' }),
      { name: 'Acme' },
      expect.objectContaining({ actorContext }),
    );
  });
});
