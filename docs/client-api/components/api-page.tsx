'use client';

import type { ReactNode } from 'react';
import { createOpenAPIPage } from 'fumadocs-openapi/ui';
import { NestedSchemaUI } from '@/components/nested-schema-ui';

export const OpenAPIPage = createOpenAPIPage({
  playground: {
    enabled: false,
  },
  // The right-hand column already shows a response example per status code, and
  // each model has its own page under "Schemas", so the middle-column response
  // schema accordions were redundant. Drop them to keep the page focused.
  showResponseSchema: false,
  // SmartLead-style inline nested properties instead of fumadocs' type popovers.
  schemaUI: {
    render(props, ctx) {
      const client = (props as { client?: { name?: string; required?: boolean; as?: 'property' | 'body' } }).client;
      const showExample = (props as { showExample?: boolean }).showExample;
      return (
        <NestedSchemaUI
          name={client?.name ?? 'schema'}
          required={client?.required}
          as={client?.as}
          root={props.root}
          readOnly={props.readOnly}
          writeOnly={props.writeOnly}
          showExample={showExample}
          getRawRef={(value) => ctx.schema.getRawRef(value)}
          processMarkdown={(md) => ctx._default_processMarkdown(md)}
        />
      );
    },
  },
  content: {
    // Wrap the request + response examples so the two different fumadocs tab
    // systems (CodeBlockTabs for languages, Tabs for response codes) can be
    // styled identically. See `.fd-example-column` in app/globals.css.
    renderAPIExampleLayout(slots: {
      selector: ReactNode;
      usageTabs: ReactNode;
      responseTabs: ReactNode;
    }) {
      return (
        <div className="fd-example-column prose-no-margin">
          {slots.selector}
          {slots.usageTabs}
          {slots.responseTabs}
        </div>
      );
    },
    // Mirror fumadocs' default two-column operation layout, but render the page
    // title/section header *inside* the content column (so it lines up with the
    // description and body instead of spanning full width over the example
    // column), and give the method + endpoint URL card (`apiPlayground`, since
    // the playground is disabled) explicit spacing.
    renderOperationLayout(
      slots: {
        header: ReactNode;
        apiPlayground: ReactNode;
        description: ReactNode;
        authSchemes: ReactNode;
        parameters: ReactNode;
        body: ReactNode;
        responses: ReactNode;
        callbacks: ReactNode;
        apiExample: ReactNode;
      },
      ctx?: { operation?: { summary?: string; tags?: string[] } },
    ) {
      const title = ctx?.operation?.summary;
      const section = ctx?.operation?.tags?.[0];
      return (
        <div className="flex flex-col gap-x-6 gap-y-4 @4xl:flex-row @4xl:items-start">
          <div className="min-w-0 flex-1">
            {title || section ? (
              <header className="mb-8 pb-6 border-b border-border">
                {section ? (
                  <p className="text-sm text-[var(--accent)] font-medium mb-2">{section}</p>
                ) : null}
                {title ? (
                  <h1 className="text-3xl font-bold text-foreground">{title}</h1>
                ) : null}
              </header>
            ) : null}
            {slots.header}
            {slots.description}
            <div className="not-prose mt-4 mb-6">{slots.apiPlayground}</div>
            {slots.authSchemes}
            {slots.parameters}
            {slots.body}
            {slots.responses}
            {slots.callbacks}
          </div>
          <div className="@4xl:sticky @4xl:top-[calc(var(--fd-docs-row-1,2rem)+1rem)] @4xl:w-[400px]">
            {slots.apiExample}
          </div>
        </div>
      );
    },
  },
});
