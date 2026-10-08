import { ToolCategory } from 'twenty-shared/ai';
import { type ActorMetadata, FieldActorSource } from 'twenty-shared/types';

import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { type CreateManyRecordsService } from 'src/engine/core-modules/record-crud/services/create-many-records.service';
import { type CreateRecordService } from 'src/engine/core-modules/record-crud/services/create-record.service';
import { ToolExecutorService } from 'src/engine/core-modules/tool-provider/services/tool-executor.service';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';

describe('ToolExecutorService', () => {
  const actorContext: ActorMetadata = {
    source: FieldActorSource.AGENT,
    workspaceMemberId: 'workspace-member-1',
    name: 'Jane Doe',
    context: {},
  };

  const context: ToolProviderContext = {
    workspaceId: 'workspace-1',
    roleId: 'role-1',
    rolePermissionConfig: { unionOf: ['role-1'] },
    authContext: {} as WorkspaceAuthContext,
    actorContext,
  };

  const buildEntry = (operation: 'create' | 'create_many'): ToolIndexEntry => ({
    name: `${operation}_company`,
    description: '',
    category: ToolCategory.DATABASE_CRUD,
    executionRef: {
      kind: 'database_crud',
      objectNameSingular: 'company',
      operation,
    },
  });

  let createRecordService: { execute: jest.Mock };
  let createManyRecordsService: { execute: jest.Mock };
  let service: ToolExecutorService;

  beforeEach(() => {
    createRecordService = { execute: jest.fn().mockResolvedValue({}) };
    createManyRecordsService = { execute: jest.fn().mockResolvedValue({}) };

    const unused = {} as never;

    service = new ToolExecutorService(
      [],
      unused,
      unused,
      createRecordService as unknown as CreateRecordService,
      createManyRecordsService as unknown as CreateManyRecordsService,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );
  });

  it('should stamp created records with the actor context', async () => {
    await service.dispatch(buildEntry('create'), { name: 'Acme' }, context);

    expect(createRecordService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: actorContext }),
    );
  });

  it('should stamp bulk created records with the actor context', async () => {
    await service.dispatch(
      buildEntry('create_many'),
      { records: [{ name: 'Acme' }] },
      context,
    );

    expect(createManyRecordsService.execute).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: actorContext }),
    );
  });
});
