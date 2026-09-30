import { FieldMetadataType } from 'twenty-shared/types';

import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';

import { type FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { computeMorphOrRelationFieldJoinColumnName } from 'src/engine/metadata-modules/field-metadata/utils/compute-morph-or-relation-field-join-column-name.util';
import { type FlatFieldMetadata } from 'src/engine/metadata-modules/flat-field-metadata/types/flat-field-metadata.type';
import { isFieldMetadataEntityOfType } from 'src/engine/utils/is-field-metadata-of-type.util';

export const getManyToOneJoinColumnName = (
  field: FieldMetadataEntity | FlatFieldMetadata,
): string | null => {
  const isRelationField =
    isFieldMetadataEntityOfType(field, FieldMetadataType.RELATION) ||
    isFieldMetadataEntityOfType(field, FieldMetadataType.MORPH_RELATION);

  if (!isRelationField) {
    return null;
  }

  if (field.settings?.relationType !== RelationType.MANY_TO_ONE) {
    return null;
  }

  return computeMorphOrRelationFieldJoinColumnName({ name: field.name });
};
