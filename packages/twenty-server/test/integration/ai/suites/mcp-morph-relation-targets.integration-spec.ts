import request from 'supertest';

type ToolCallResult = {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
};

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

describe('MCP morph relation targets (integration)', () => {
  const baseUrl = `http://localhost:${APP_PORT}`;

  const callMcp = (method: string, params: Record<string, unknown>) =>
    request(baseUrl)
      .post('/mcp')
      .set('Authorization', `Bearer ${API_KEY_ACCESS_TOKEN}`)
      .set('Content-Type', 'application/json')
      .set('Accept', 'application/json')
      .send(JSON.stringify({ jsonrpc: '2.0', id: method, method, params }))
      .expect(200);

  const callTool = async (
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const response = await callMcp('tools/call', { name, arguments: args });

    expect(response.body.error).toBeUndefined();

    const result: ToolCallResult = response.body.result;

    expect(result.isError).not.toBe(true);

    return result.content[0].text;
  };

  const executeTool = (toolName: string, args: Record<string, unknown>) =>
    callTool('execute_tool', { toolName, arguments: args });

  const createRecordAndGetId = async (
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> => {
    const output = await executeTool(toolName, {
      position: 'first',
      ...args,
    });

    expect(output).toContain('"success":true');

    const recordId = output.match(UUID_PATTERN)?.[0];

    expect(recordId).toBeDefined();

    return recordId as string;
  };

  it('should advertise the morph join columns as uuid fields on note targets', async () => {
    const learned = await callTool('learn_tools', {
      toolNames: ['create_note_target'],
    });

    expect(learned).toContain('targetCompanyId');
    expect(learned).toContain('targetPersonId');
    expect(learned).toContain('targetOpportunityId');
    expect(learned).not.toMatch(/"targetCompany":\{/);
  });

  it('should link a created note to a company and read the link back', async () => {
    const companyId = await createRecordAndGetId('create_company', {
      name: 'Alpha Firm',
    });
    const noteId = await createRecordAndGetId('create_note', {
      title: 'Met with client on 2nd September',
    });

    await createRecordAndGetId('create_note_target', {
      noteId,
      targetCompanyId: companyId,
    });

    const foundTargets = await executeTool('find_note_targets', {
      limit: 100,
      offset: 0,
      targetCompanyId: { eq: companyId },
    });

    expect(foundTargets).toContain(noteId);
    expect(foundTargets).toContain(companyId);
  });

  it('should link a created task to a company and read the link back', async () => {
    const companyId = await createRecordAndGetId('create_company', {
      name: 'Beta Firm',
    });
    const taskId = await createRecordAndGetId('create_task', {
      title: 'Follow up with Beta Firm',
    });

    await createRecordAndGetId('create_task_target', {
      taskId,
      targetCompanyId: companyId,
    });

    const foundTargets = await executeTool('find_task_targets', {
      limit: 100,
      offset: 0,
      targetCompanyId: { eq: companyId },
    });

    expect(foundTargets).toContain(taskId);
    expect(foundTargets).toContain(companyId);
  });
});
