import request from 'supertest';

type ToolCallResult = {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
};

type ToolOutput = {
  success: boolean;
  result: { id: string };
};

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
    const output: ToolOutput = JSON.parse(
      await executeTool(toolName, { position: 'first', ...args }),
    );

    expect(output.success).toBe(true);
    expect(output.result.id).toBeDefined();

    return output.result.id;
  };

  const findTargetsFor = (toolName: string, companyId: string) =>
    executeTool(toolName, {
      limit: 100,
      offset: 0,
      targetCompanyId: { eq: companyId },
    });

  it('should advertise the morph join columns as uuid fields on note targets', async () => {
    const learned = await callTool('learn_tools', {
      toolNames: ['create_note_target'],
    });

    expect(learned).toContain('targetCompanyId');
    expect(learned).toContain('targetPersonId');
    expect(learned).toContain('targetOpportunityId');
    expect(learned).not.toMatch(/"targetCompany":\{/);
  });

  it('should link notes to a company and filter the links by that company', async () => {
    const alphaId = await createRecordAndGetId('create_company', {
      name: 'Alpha Firm',
    });
    const gammaId = await createRecordAndGetId('create_company', {
      name: 'Gamma Firm',
    });
    const alphaNoteId = await createRecordAndGetId('create_note', {
      title: 'Met with client on 2nd September',
    });
    const gammaNoteId = await createRecordAndGetId('create_note', {
      title: 'Met with Gamma on 3rd September',
    });

    await createRecordAndGetId('create_note_target', {
      noteId: alphaNoteId,
      targetCompanyId: alphaId,
    });
    await createRecordAndGetId('create_note_target', {
      noteId: gammaNoteId,
      targetCompanyId: gammaId,
    });

    const alphaTargets = await findTargetsFor('find_note_targets', alphaId);

    expect(alphaTargets).toContain(alphaNoteId);
    expect(alphaTargets).not.toContain(gammaNoteId);
  });

  it('should link tasks to a company and filter the links by that company', async () => {
    const betaId = await createRecordAndGetId('create_company', {
      name: 'Beta Firm',
    });
    const deltaId = await createRecordAndGetId('create_company', {
      name: 'Delta Firm',
    });
    const betaTaskId = await createRecordAndGetId('create_task', {
      title: 'Follow up with Beta Firm',
    });
    const deltaTaskId = await createRecordAndGetId('create_task', {
      title: 'Follow up with Delta Firm',
    });

    await createRecordAndGetId('create_task_target', {
      taskId: betaTaskId,
      targetCompanyId: betaId,
    });
    await createRecordAndGetId('create_task_target', {
      taskId: deltaTaskId,
      targetCompanyId: deltaId,
    });

    const betaTargets = await findTargetsFor('find_task_targets', betaId);

    expect(betaTargets).toContain(betaTaskId);
    expect(betaTargets).not.toContain(deltaTaskId);
  });
});
