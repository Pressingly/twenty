import { canObjectBeManagedByWorkflow } from 'twenty-shared/workflow';

const LINKING_SYSTEM_OBJECT_NAMES = ['noteTarget', 'taskTarget'];

export const canRecordCrudToolsManageObject = ({
  nameSingular,
  isSystem,
}: {
  nameSingular: string;
  isSystem: boolean;
}) =>
  LINKING_SYSTEM_OBJECT_NAMES.includes(nameSingular) ||
  canObjectBeManagedByWorkflow({ nameSingular, isSystem });
