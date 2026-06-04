import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Alert } from '@/components/ui/feedback/Alert';
import { Button } from '@/components/ui/button';
import { BaseModal, ModalFooter } from '@/components/ui/modals';
import { WizardStepIndicator } from '@/components/ui/wizard';
import { createCsvBuilderToolJob } from '@/lib/foundry/registry-client';
import { getCsvBuilderToolManifest } from '@/lib/foundry/csv-builder';
import type { CsvBuilderColumnRow } from '@/lib/foundry/registry-types';
import {
  CsvBuilderAddColumnWizardProvider,
  useCsvBuilderAddColumnWizard,
} from './CsvBuilderAddColumnWizardContext';
import {
  CSV_BUILDER_WIZARD_STEPS,
  CsvBuilderInputMappingStep,
  CsvBuilderOutputSelectionStep,
  CsvBuilderReviewStep,
  CsvBuilderToolSelectionStep,
} from './CsvBuilderAddColumnWizardSteps';

function CsvBuilderAddColumnWizardInner({
  runId,
  columns,
  onClose,
  onCreated,
}: {
  runId: string;
  columns: CsvBuilderColumnRow[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const {
    step,
    setStep,
    toolType,
    label,
    inputMapping,
    selectedOutputs,
    includeRawJson,
    resetWizard,
  } = useCsvBuilderAddColumnWizard();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manifest = useMemo(() => (toolType ? getCsvBuilderToolManifest(toolType) : null), [toolType]);
  const canContinue =
    step === 0
      ? Boolean(toolType)
      : step === 1
        ? Boolean(
            manifest?.inputs.every((input) => {
              return !input.required || Boolean(inputMapping[input.key]?.trim());
            }) &&
              (label.trim() || manifest?.label),
          )
        : step === 2
          ? selectedOutputs.length > 0 || includeRawJson
          : true;

  async function handleCreate() {
    if (!toolType || !manifest) return;
    setBusy(true);
    setError(null);
    try {
      await createCsvBuilderToolJob(runId, {
        label: label.trim() || manifest.label,
        tool_type: toolType,
        config: {
          tool_type: toolType,
          input_mapping: inputMapping,
          selected_outputs: selectedOutputs,
          include_raw_json: includeRawJson,
          result_parser_version: 'v1',
        },
      });
      await onCreated();
      resetWizard();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create CSV Builder tool job');
    } finally {
      setBusy(false);
    }
  }

  return (
    <BaseModal
      visible
      onClose={() => {
        resetWizard();
        onClose();
      }}
      title="Add column"
      description="Use the existing multi-step wizard pattern to map inputs, choose outputs, and launch a background job."
      maxWidth="3xl"
      height={760}
      footer={
        <ModalFooter>
          <Button
            variant="secondary"
            onPress={() => {
              if (step === 0) {
                resetWizard();
                onClose();
                return;
              }
              setStep((step - 1) as 0 | 1 | 2 | 3);
            }}
            disabled={busy}
          >
            {step === 0 ? 'Close' : 'Back'}
          </Button>
          {step < CSV_BUILDER_WIZARD_STEPS.length - 1 ? (
            <Button
              onPress={() => setStep((step + 1) as 0 | 1 | 2 | 3)}
              disabled={!canContinue || busy}
            >
              Next
            </Button>
          ) : (
            <Button onPress={() => void handleCreate()} disabled={!canContinue || busy}>
              {busy ? 'Creating…' : 'Create columns'}
            </Button>
          )}
        </ModalFooter>
      }
    >
      <View className="gap-6">
        <WizardStepIndicator steps={CSV_BUILDER_WIZARD_STEPS} activeIndex={step} wrap />
        {error ? <Alert variant="error" message={error} /> : null}
        {step === 0 ? <CsvBuilderToolSelectionStep /> : null}
        {step === 1 ? <CsvBuilderInputMappingStep columns={columns} /> : null}
        {step === 2 ? <CsvBuilderOutputSelectionStep /> : null}
        {step === 3 ? <CsvBuilderReviewStep columns={columns} /> : null}
        {!canContinue && step > 0 ? (
          <Text className="text-amber-300 font-instrument text-xs">
            Complete the required inputs and select at least one output to continue.
          </Text>
        ) : null}
      </View>
    </BaseModal>
  );
}

export function CsvBuilderAddColumnWizard({
  visible,
  runId,
  columns,
  onClose,
  onCreated,
}: {
  visible: boolean;
  runId: string;
  columns: CsvBuilderColumnRow[];
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  if (!visible) return null;
  return (
    <CsvBuilderAddColumnWizardProvider columns={columns}>
      <CsvBuilderAddColumnWizardInner runId={runId} columns={columns} onClose={onClose} onCreated={onCreated} />
    </CsvBuilderAddColumnWizardProvider>
  );
}
