import { type DataSource } from 'typeorm';

import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { BackfillWorkflowVersionCoreLinksCommand } from 'src/database/commands/upgrade-version-command/2-22/2-22-workspace-command-1784193207000-backfill-workflow-version-core-links.command';
import { type WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const WORKSPACE_ID = '20202020-0000-0000-0000-000000000001';

const WORKFLOW_VERSIONS = [
  { id: 'version-1', workflowId: 'workflow-1', status: 'ACTIVE', steps: [] },
  { id: 'version-2', workflowId: 'workflow-2', status: 'DRAFT', steps: [] },
];

const setup = ({ failingInsert = false }: { failingInsert?: boolean } = {}) => {
  const events: string[] = [];

  const query = jest.fn(async (sql: string) => {
    if (sql.includes('FROM core."workspace"')) {
      return [
        {
          databaseSchema: 'workspace_test',
          workspaceCustomApplicationId: 'application-1',
        },
      ];
    }

    if (failingInsert && sql.includes('INSERT INTO core."workflowVersion"')) {
      throw new Error('insert failed');
    }

    return [];
  });

  const queryRunner = {
    connect: jest.fn(),
    release: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(async () => {
      events.push('commit');
    }),
    rollbackTransaction: jest.fn(),
    query,
  };

  const dataSource = {
    createQueryRunner: () => queryRunner,
  } as unknown as DataSource;

  const flush = jest.fn(async () => {
    events.push('flush');
  });
  const invalidateAndRecompute = jest.fn();

  const workspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(async () => WORKFLOW_VERSIONS),
  } as unknown as WorkspaceOrmManager;

  const command = new BackfillWorkflowVersionCoreLinksCommand(
    {} as WorkspaceIteratorService,
    { flush, invalidateAndRecompute } as unknown as WorkspaceCacheService,
    workspaceOrmManager,
  );

  const run = (dryRun = false) =>
    command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      dataSource,
      options: { dryRun },
      index: 0,
      total: 1,
    });

  return { run, query, flush, invalidateAndRecompute, events };
};

describe('BackfillWorkflowVersionCoreLinksCommand', () => {
  beforeEach(() => jest.clearAllMocks());

  it('flushes the flat workflow version maps after rebuilding the core rows', async () => {
    const { run, query, flush, invalidateAndRecompute, events } = setup();

    await run();

    const insertCount = query.mock.calls.filter(([sql]) =>
      sql.includes('INSERT INTO core."workflowVersion"'),
    ).length;

    expect(insertCount).toBe(WORKFLOW_VERSIONS.length);
    expect(flush).toHaveBeenCalledWith(WORKSPACE_ID, [
      'flatWorkflowVersionMaps',
    ]);
    expect(events).toEqual(['commit', 'flush']);
    expect(invalidateAndRecompute).toHaveBeenCalledWith(WORKSPACE_ID, [
      'workflowAutomatedTriggerMaps',
    ]);
  });

  it('leaves the cache alone on a dry run', async () => {
    const { run, query, flush } = setup();

    await run(true);

    expect(query).not.toHaveBeenCalled();
    expect(flush).not.toHaveBeenCalled();
  });

  it('leaves the cache alone when the rebuild rolls back', async () => {
    const { run, flush } = setup({ failingInsert: true });

    await expect(run()).rejects.toThrow('insert failed');

    expect(flush).not.toHaveBeenCalled();
  });
});
