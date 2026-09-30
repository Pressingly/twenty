import { canObjectBeManagedByWorkflow } from 'twenty-shared/workflow';

const LINKING_SYSTEM_OBJECT_NAMES = ['noteTarget', 'taskTarget'];

export const canRecordCrudManageObject = ({
  nameSingular,
  isSystem,
  allowLinkingSystemObjects = false,
}: {
  nameSingular: string;
  isSystem: boolean;
  allowLinkingSystemObjects?: boolean;
}) =>
  (allowLinkingSystemObjects &&
    LINKING_SYSTEM_OBJECT_NAMES.includes(nameSingular)) ||
  canObjectBeManagedByWorkflow({ nameSingular, isSystem });
