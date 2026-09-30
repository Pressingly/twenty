import { canRecordCrudToolsManageObject } from 'src/engine/core-modules/record-crud/utils/can-record-crud-tools-manage-object.util';

describe('canRecordCrudToolsManageObject', () => {
  it.each(['noteTarget', 'taskTarget'])(
    'should allow the system linking object %s',
    (nameSingular) => {
      expect(
        canRecordCrudToolsManageObject({ nameSingular, isSystem: true }),
      ).toBe(true);
    },
  );

  it('should allow a regular non system object', () => {
    expect(
      canRecordCrudToolsManageObject({
        nameSingular: 'company',
        isSystem: false,
      }),
    ).toBe(true);
  });

  it.each(['message', 'connectedAccount', 'workspaceMember'])(
    'should still reject the other system object %s',
    (nameSingular) => {
      expect(
        canRecordCrudToolsManageObject({ nameSingular, isSystem: true }),
      ).toBe(false);
    },
  );

  it.each(['workflow', 'workflowVersion', 'workflowRun', 'dashboard'])(
    'should still reject the workflow related object %s',
    (nameSingular) => {
      expect(
        canRecordCrudToolsManageObject({ nameSingular, isSystem: false }),
      ).toBe(false);
    },
  );
});
