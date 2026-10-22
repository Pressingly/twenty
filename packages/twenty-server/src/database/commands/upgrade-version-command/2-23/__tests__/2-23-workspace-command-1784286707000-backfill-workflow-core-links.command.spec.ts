import { type DataSource } from 'typeorm';

import { type WorkspaceIteratorService } from 'src/database/commands/command-runners/workspace-iterator.service';
import { BackfillWorkflowCoreLinksCommand } from 'src/database/commands/upgrade-version-command/2-23/2-23-workspace-command-1784286707000-backfill-workflow-core-links.command';
import { type WorkspaceOrmManager } from 'src/engine/twenty-orm/workspace-orm.manager';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const WORKSPACE_ID = '20202020-0000-0000-0000-000000000001';

const WORKFLOWS = [
  { id: 'workflow-1', name: 'First', lastPublishedVersionId: 'version-1' },
  { id: 'workflow-2', name: 'Second', lastPublishedVersionId: null },
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

    if (failingInsert && sql.includes('INSERT INTO core."workflow"')) {
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

  const workspaceOrmManager = {
    executeInWorkspaceContext: jest.fn(async () => WORKFLOWS),
  } as unknown as WorkspaceOrmManager;

  const command = new BackfillWorkflowCoreLinksCommand(
    {} as WorkspaceIteratorService,
    workspaceOrmManager,
    { flush } as unknown as WorkspaceCacheService,
  );

  const run = (dryRun = false) =>
    command.runOnWorkspace({
      workspaceId: WORKSPACE_ID,
      dataSource,
      options: { dryRun },
      index: 0,
      total: 1,
    });

  return { run, query, flush, events };
};

describe('BackfillWorkflowCoreLinksCommand', () => {
  beforeEach(() => jest.clearAllMocks());

  it('flushes the flat workflow maps after rebuilding the core rows', async () => {
    const { run, query, flush, events } = setup();

    await run();

    const insertCount = query.mock.calls.filter(([sql]) =>
      sql.includes('INSERT INTO core."workflow"'),
    ).length;

    expect(insertCount).toBe(WORKFLOWS.length);
    expect(flush).toHaveBeenCalledWith(WORKSPACE_ID, ['flatWorkflowMaps']);
    expect(events).toEqual(['commit', 'flush']);
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
