import { FieldMetadataType, RelationOnDeleteAction } from 'twenty-shared/types';

import { RelationType } from 'src/engine/metadata-modules/field-metadata/interfaces/relation-type.interface';

import { type ObjectMetadataForToolSchema } from 'src/engine/core-modules/record-crud/types/object-metadata-for-tool-schema.type';
import { getManyToOneJoinColumnName } from 'src/engine/core-modules/record-crud/utils/get-many-to-one-join-column-name.util';
import { generateFieldFilterZodSchema } from 'src/engine/core-modules/record-crud/zod-schemas/field-filters.zod-schema';
import { generateRecordFilterSchema } from 'src/engine/core-modules/record-crud/zod-schemas/record-filter.zod-schema';
import { generateRecordPropertiesZodSchema } from 'src/engine/core-modules/record-crud/zod-schemas/record-properties.zod-schema';
import { getFlatFieldMetadataMock } from 'src/engine/metadata-modules/flat-field-metadata/__mocks__/get-flat-field-metadata.mock';

const OBJECT_METADATA_ID = '12e3cb51-c3de-4192-b0d5-965d48d001c0';

const buildRelationField = (
  type: FieldMetadataType.RELATION | FieldMetadataType.MORPH_RELATION,
  name: string,
  relationType: RelationType,
  joinColumnName?: string,
) =>
  getFlatFieldMetadataMock({
    universalIdentifier: `universal-${name}`,
    objectMetadataId: OBJECT_METADATA_ID,
    type,
    name,
    settings: {
      onDelete: RelationOnDeleteAction.CASCADE,
      relationType,
      joinColumnName,
    },
  });

const noteField = buildRelationField(
  FieldMetadataType.RELATION,
  'note',
  RelationType.MANY_TO_ONE,
  'noteId',
);
const targetCompanyField = buildRelationField(
  FieldMetadataType.MORPH_RELATION,
  'targetCompany',
  RelationType.MANY_TO_ONE,
  'targetCompanyId',
);
const oneToManyField = buildRelationField(
  FieldMetadataType.RELATION,
  'noteTargets',
  RelationType.ONE_TO_MANY,
);

const objectMetadata = {
  fields: [noteField, targetCompanyField],
} as ObjectMetadataForToolSchema;

describe('getManyToOneJoinColumnName', () => {
  it('should return the join column for a many-to-one relation', () => {
    expect(getManyToOneJoinColumnName(noteField)).toBe('noteId');
  });

  it('should return the join column for a many-to-one morph relation', () => {
    expect(getManyToOneJoinColumnName(targetCompanyField)).toBe(
      'targetCompanyId',
    );
  });

  it('should derive the join column from the field name like the write path does', () => {
    const field = buildRelationField(
      FieldMetadataType.MORPH_RELATION,
      'targetPerson',
      RelationType.MANY_TO_ONE,
    );

    expect(getManyToOneJoinColumnName(field)).toBe('targetPersonId');
  });

  it('should return null for a one-to-many relation', () => {
    expect(getManyToOneJoinColumnName(oneToManyField)).toBeNull();
  });

  it('should return null for a non relation field', () => {
    const field = getFlatFieldMetadataMock({
      universalIdentifier: 'universal-title',
      objectMetadataId: OBJECT_METADATA_ID,
      type: FieldMetadataType.TEXT,
      name: 'title',
    });

    expect(getManyToOneJoinColumnName(field)).toBeNull();
  });
});

describe('record crud schemas for morph relations', () => {
  it('should expose the morph join column as a uuid on create and update', () => {
    const shape = generateRecordPropertiesZodSchema(objectMetadata).shape;

    expect(Object.keys(shape)).toEqual(['noteId', 'targetCompanyId']);
  });

  it('should reject a non uuid value for the morph join column', () => {
    const schema = generateRecordPropertiesZodSchema(objectMetadata);

    expect(schema.safeParse({ targetCompanyId: 'Alpha Firm' }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        targetCompanyId: '5f9c4d0e-6d3b-4c2a-9d1e-2b7a8c3f4e10',
      }).success,
    ).toBe(true);
  });

  it('should not expose a morph one-to-many relation as a writable property', () => {
    const morphOneToManyField = buildRelationField(
      FieldMetadataType.MORPH_RELATION,
      'targetedBy',
      RelationType.ONE_TO_MANY,
    );
    const shape = generateRecordPropertiesZodSchema({
      fields: [morphOneToManyField],
    } as ObjectMetadataForToolSchema).shape;

    expect(Object.keys(shape)).toEqual([]);
  });

  it('should key the find filter on the morph join column', () => {
    const { filterShape } = generateRecordFilterSchema(objectMetadata);

    expect(Object.keys(filterShape)).toEqual(['noteId', 'targetCompanyId']);
  });

  it('should build a uuid filter for a morph relation field', () => {
    const filter = generateFieldFilterZodSchema(targetCompanyField);

    expect(filter?.safeParse({ eq: 'Alpha Firm' }).success).toBe(false);
    expect(
      filter?.safeParse({ eq: '5f9c4d0e-6d3b-4c2a-9d1e-2b7a8c3f4e10' }).success,
    ).toBe(true);
  });
});
