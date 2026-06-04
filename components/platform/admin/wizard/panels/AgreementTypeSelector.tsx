import { FormFieldGroup } from '@/components/ui/forms/FormFieldGroup';
import { SegmentControl } from '@/components/ui/segment-control';
import {
  AGREEMENT_TYPE_OPTIONS,
  type AgreementType,
} from '@/lib/platform/contract/terms';

type AgreementTypeSelectorProps = {
  value: AgreementType;
  onChange: (value: AgreementType) => void;
};

export function AgreementTypeSelector({
  value,
  onChange,
}: AgreementTypeSelectorProps) {
  return (
    <FormFieldGroup label="Agreement type">
      <SegmentControl
        options={AGREEMENT_TYPE_OPTIONS.map((option) => ({
          value: option.type,
          label: option.label,
        }))}
        value={value}
        onChange={(next) => onChange(next as AgreementType)}
      />
    </FormFieldGroup>
  );
}
