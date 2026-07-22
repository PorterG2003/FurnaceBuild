'use client';

import { OpenAPIPage } from '@/components/api-page';
import type { SchemaOperationRef } from '@/lib/schema-operations';

type SchemaModelPageProps = {
  name: string;
  operation: SchemaOperationRef;
  bundled: Record<string, unknown>;
  description?: string;
};

export function SchemaModelPage({ name, operation, bundled, description }: SchemaModelPageProps) {
  return (
    <div className="openapi-schema-model space-y-6">
      {description ? (
        <p className="text-base text-muted-foreground whitespace-pre-wrap">{description}</p>
      ) : null}
      <OpenAPIPage
        payload={{ bundled }}
        operations={[operation]}
        showTitle={false}
        showDescription={false}
      />
    </div>
  );
}
