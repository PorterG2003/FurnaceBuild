import { SelectableOptionCards } from '@/components/ui/wizard';
import type { AmendmentWizardPath } from '@/lib/platform/amendment/wizard';

type AmendmentPathStepProps = {
  options: Array<{ id: AmendmentWizardPath; label: string; description: string }>;
  wizardPath: AmendmentWizardPath;
  onSelect: (path: AmendmentWizardPath) => void;
};

export function AmendmentPathStep({ options, wizardPath, onSelect }: AmendmentPathStepProps) {
  return (
    <SelectableOptionCards options={options} selectedId={wizardPath} onSelect={onSelect} />
  );
}
