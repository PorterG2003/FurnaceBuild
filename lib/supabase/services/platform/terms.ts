import type { PlatformTermsVersion } from '../../types';
import type { AgreementType } from '@/lib/platform/contract/terms';
import { rpc } from './rpc';

export async function listPlatformTermsVersions(): Promise<PlatformTermsVersion[]> {
  const { data, error } = await rpc('list_platform_terms_versions');
  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformTermsVersion[];
}

export async function createPlatformTermsVersion(params: {
  version: string;
  title: string;
  bodyMarkdown: string;
  effectiveAt?: string | null;
  isDefault?: boolean;
  agreementType?: AgreementType;
}): Promise<PlatformTermsVersion> {
  const { data, error } = await rpc('create_platform_terms_version', {
    p_version: params.version,
    p_title: params.title,
    p_body_markdown: params.bodyMarkdown,
    p_effective_at: params.effectiveAt ?? null,
    p_is_default: params.isDefault ?? false,
    p_agreement_type: params.agreementType ?? 'platform_agreement',
  });
  if (error) throw new Error(error.message);
  return data as PlatformTermsVersion;
}

export async function upsertPlatformTermsTemplate(params: {
  agreementType: AgreementType;
  title: string;
  bodyMarkdown: string;
}): Promise<PlatformTermsVersion> {
  const { data, error } = await rpc('upsert_platform_terms_template', {
    p_agreement_type: params.agreementType,
    p_title: params.title,
    p_body_markdown: params.bodyMarkdown,
  });
  if (error) throw new Error(error.message);
  return data as PlatformTermsVersion;
}

export async function setDefaultPlatformTermsVersion(version: string): Promise<PlatformTermsVersion> {
  const { data, error } = await rpc('set_default_platform_terms_version', {
    p_version: version,
  });
  if (error) throw new Error(error.message);
  return data as PlatformTermsVersion;
}
