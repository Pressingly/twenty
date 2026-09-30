import { canRecordCrudManageObject } from 'src/engine/core-modules/record-crud/utils/can-record-crud-manage-object.util';

describe('canRecordCrudManageObject', () => {
  describe.each(['noteTarget', 'taskTarget'])(
    'linking object %s',
    (nameSingular) => {
      it('should reject it by default so workflows stay strict', () => {
        expect(
          canRecordCrudManageObject({ nameSingular, isSystem: true }),
        ).toBe(false);
      });

      it('should allow it when linking system objects is enabled', () => {
        expect(
          canRecordCrudManageObject({
            nameSingular,
            isSystem: true,
            allowLinkingSystemObjects: true,
          }),
        ).toBe(true);
      });
    },
  );

  it.each([false, true])(
    'should allow a regular non system object (allowLinkingSystemObjects=%s)',
    (allowLinkingSystemObjects) => {
      expect(
        canRecordCrudManageObject({
          nameSingular: 'company',
          isSystem: false,
          allowLinkingSystemObjects,
        }),
      ).toBe(true);
    },
  );

  it.each(['message', 'connectedAccount', 'workspaceMember'])(
    'should still reject the other system object %s when linking is enabled',
    (nameSingular) => {
      expect(
        canRecordCrudManageObject({
          nameSingular,
          isSystem: true,
          allowLinkingSystemObjects: true,
        }),
      ).toBe(false);
    },
  );

  it.each(['workflow', 'workflowVersion', 'workflowRun', 'dashboard'])(
    'should still reject the workflow related object %s when linking is enabled',
    (nameSingular) => {
      expect(
        canRecordCrudManageObject({
          nameSingular,
          isSystem: false,
          allowLinkingSystemObjects: true,
        }),
      ).toBe(false);
    },
  );
});
