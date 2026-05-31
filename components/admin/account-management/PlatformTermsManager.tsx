import { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { LoadingState, useToast } from '@/components/ui/feedback';
import {
  authInputClassName,
  authInputStyle,
  authPlaceholderColor,
} from '@/components/auth/authFormStyles';
import { AdminField } from '@/components/admin/account-management/shared';
import {
  listPlatformTermsVersions,
  upsertPlatformTermsTemplate,
} from '@/lib/supabase/services/platform';
import {
  AGREEMENT_TYPE_OPTIONS,
  getAgreementTemplateMarkdown,
  getAgreementTypeVersion,
  getAgreementTypeTitle,
  type AgreementType,
} from '@/lib/platform-invite/terms';
import { PlatformTermsMarkdown } from '@/components/platform-invite/PlatformTermsMarkdown';

type TemplateEditorState = Record<
  AgreementType,
  {
    title: string;
    bodyMarkdown: string;
  }
>;

const EMPTY_TEMPLATE_STATE: TemplateEditorState = {
  platform_agreement: {
    title: getAgreementTypeTitle('platform_agreement'),
    bodyMarkdown: getAgreementTemplateMarkdown('platform_agreement'),
  },
  managed_services_agreement: {
    title: getAgreementTypeTitle('managed_services_agreement'),
    bodyMarkdown: getAgreementTemplateMarkdown('managed_services_agreement'),
  },
};

export function PlatformTermsManager() {
  const { toast } = useToast();
  const [termsVersions, setTermsVersions] = useState<Awaited<ReturnType<typeof listPlatformTermsVersions>>>([]);
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<AgreementType | null>(null);
  const [templates, setTemplates] = useState<TemplateEditorState>(EMPTY_TEMPLATE_STATE);

  const loadTermsVersions = async () => {
    setLoading(true);
    try {
      setTermsVersions(await listPlatformTermsVersions());
    } catch (err) {
      setTermsVersions([]);
      toast.error(err instanceof Error ? err.message : 'Failed to load terms versions.');
    } finally {
      setLoading(false);
    }
  };

  const activeTemplates = useMemo(() => {
    const byType = {
      platform_agreement: null,
      managed_services_agreement: null,
    } as Record<AgreementType, (typeof termsVersions)[number] | null>;

    for (const agreementType of Object.keys(byType) as AgreementType[]) {
      byType[agreementType] =
        termsVersions.find((item) => item.agreement_type === agreementType && item.is_default) ??
        termsVersions.find((item) => item.agreement_type === agreementType) ??
        null;
    }

    return byType;
  }, [termsVersions]);

  const templateMetadata = useMemo(
    () =>
      ({
        platform_agreement: activeTemplates.platform_agreement ?? {
          version: getAgreementTypeVersion('platform_agreement'),
        },
        managed_services_agreement: activeTemplates.managed_services_agreement ?? {
          version: getAgreementTypeVersion('managed_services_agreement'),
        },
      }) as Record<AgreementType, { version: string }>,
    [activeTemplates],
  );

  useEffect(() => {
    void loadTermsVersions();
  }, []);

  useEffect(() => {
    setTemplates((current) => {
      const next = { ...current };
      for (const agreementType of Object.keys(activeTemplates) as AgreementType[]) {
        const template = activeTemplates[agreementType];
        if (!template) continue;
        next[agreementType] = {
          title: template.title,
          bodyMarkdown: template.body_markdown,
        };
      }
      return next;
    });
  }, [activeTemplates]);

  const handleSaveTemplate = async (agreementType: AgreementType) => {
    const template = templates[agreementType];
    if (!template.title.trim() || !template.bodyMarkdown.trim()) {
      toast.error('Title and markdown are required.');
      return;
    }

    setSavingType(agreementType);
    try {
      await upsertPlatformTermsTemplate({
        agreementType,
        title: template.title.trim(),
        bodyMarkdown: template.bodyMarkdown,
      });
      toast.success(`${getAgreementTypeTitle(agreementType)} updated.`);
      await loadTermsVersions();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update agreement template.');
    } finally {
      setSavingType(null);
    }
  };

  return (
    <View className="rounded-2xl border border-[#2A2A2A] bg-[#181818] p-5">
      <View className="mb-5">
        <Text className="mb-2 text-xl font-instrument-semibold text-white">Agreement templates</Text>
        <Text className="font-instrument text-gray-400">
          Manage the default markdown templates used when platform invites are created. Invite senders
          can still edit the raw markdown per invite before anything is sent.
        </Text>
      </View>

      {loading && termsVersions.length === 0 ? <LoadingState message="Loading agreement templates..." /> : null}

      <View className="gap-6">
        {AGREEMENT_TYPE_OPTIONS.map((option) => {
          const template = templates[option.type];
          const activeTemplate = templateMetadata[option.type];
          return (
            <View key={option.type} className="rounded-xl border border-[#2A2A2A] bg-[#121212] p-4">
              <View className="mb-4 gap-1">
                <Text className="text-lg font-instrument-semibold text-white">{option.label}</Text>
                <Text className="font-instrument text-sm text-gray-400">
                  Internal template key: {activeTemplate.version}
                </Text>
              </View>

              <AdminField label="Title">
                <TextInput
                  value={template.title}
                  onChangeText={(value) =>
                    setTemplates((current) => ({
                      ...current,
                      [option.type]: {
                        ...current[option.type],
                        title: value,
                      },
                    }))
                  }
                  className={authInputClassName}
                  style={authInputStyle}
                />
              </AdminField>

              <AdminField label="Raw markdown">
                <TextInput
                  value={template.bodyMarkdown}
                  onChangeText={(value) =>
                    setTemplates((current) => ({
                      ...current,
                      [option.type]: {
                        ...current[option.type],
                        bodyMarkdown: value,
                      },
                    }))
                  }
                  placeholder="Paste the full markdown here"
                  placeholderTextColor={authPlaceholderColor}
                  className={authInputClassName}
                  style={{ ...authInputStyle, minHeight: 220, textAlignVertical: 'top' }}
                  multiline
                />
              </AdminField>

              <View className="mb-4 rounded-xl border border-[#2A2A2A] bg-[#181818] p-4">
                <Text className="mb-3 text-sm font-instrument-medium text-white">Rendered preview</Text>
                <PlatformTermsMarkdown markdown={template.bodyMarkdown || 'Template preview will appear here.'} />
              </View>

              <Button onPress={() => void handleSaveTemplate(option.type)} disabled={savingType === option.type}>
                {savingType === option.type ? 'Saving template...' : `Save ${option.label}`}
              </Button>
            </View>
          );
        })}
      </View>
    </View>
  );
}
