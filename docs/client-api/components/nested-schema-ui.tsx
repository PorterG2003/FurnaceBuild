'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  generateSchemaUI,
  type SchemaData,
  type SchemaDataObjectProperty,
} from '@fumadocs/api-docs/components/schema';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type SchemaRefs = Record<string, SchemaData>;

type NestedSchemaUIProps = {
  name: string;
  required?: boolean;
  as?: 'property' | 'body';
  root: unknown;
  readOnly?: boolean;
  writeOnly?: boolean;
  showExample?: boolean;
  getRawRef: (value: object) => string | undefined;
  processMarkdown: (md: string) => ReactNode;
};

const MAX_NEST_DEPTH = 4;

function TypeBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs font-mono text-muted-foreground">
      {children}
    </span>
  );
}

function PropertyHeader({
  name,
  required,
  typeLabel,
}: {
  name: string;
  required: boolean;
  typeLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-sm font-medium text-[var(--accent)]">
        {name}
        {required ? null : (
          <span className="text-muted-foreground font-normal">?</span>
        )}
      </span>
      <TypeBadge>{typeLabel}</TypeBadge>
    </div>
  );
}

function NestedBox({
  label,
  defaultOpen,
  children,
}: {
  label: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="schema-nest mt-3 overflow-hidden rounded-lg border border-border bg-[var(--furnace-bg-panel)]">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 transition-transform',
            open ? 'rotate-0' : '-rotate-90',
          )}
        />
        <span>
          {open ? 'Hide' : 'Show'} {label} properties
        </span>
      </button>
      {open ? (
        <div className="border-t border-border divide-y divide-border">{children}</div>
      ) : null}
    </div>
  );
}

function canNest(schema: SchemaData | undefined): schema is SchemaData & {
  type: 'object';
  props: SchemaDataObjectProperty[];
} {
  return Boolean(schema && schema.type === 'object' && schema.props.length > 0);
}

function PropertyRow({
  name,
  required,
  $type,
  refs,
  depth,
}: {
  name: string;
  required: boolean;
  $type: string;
  refs: SchemaRefs;
  depth: number;
}) {
  const schema = refs[$type];
  if (!schema) return null;

  const itemSchema = schema.type === 'array' ? refs[schema.item.$type] : undefined;
  const nestObject = depth < MAX_NEST_DEPTH && canNest(schema);
  const nestArrayItem = depth < MAX_NEST_DEPTH && canNest(itemSchema);

  return (
    <div className="schema-prop px-3 py-3.5">
      <PropertyHeader
        name={name}
        required={required}
        typeLabel={schema.aliasName}
      />
      {schema.description ? (
        <div className="schema-prop-desc mt-1.5 text-sm text-muted-foreground [&_p]:my-0 [&_ul]:my-1.5 [&_ul]:ps-4 [&_li]:my-0.5">
          {schema.description}
        </div>
      ) : null}
      {schema.infoTags && schema.infoTags.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {schema.infoTags.map((tag, index) => (
            <span key={index}>{tag.node}</span>
          ))}
        </div>
      ) : null}
      {nestObject ? (
        <NestedBox label={name} defaultOpen={depth === 0}>
          {schema.props.map((prop) => (
            <PropertyRow
              key={prop.name}
              name={prop.name}
              required={prop.required}
              $type={prop.$type}
              refs={refs}
              depth={depth + 1}
            />
          ))}
        </NestedBox>
      ) : null}
      {nestArrayItem ? (
        <NestedBox label={`${name} item`} defaultOpen={false}>
          {itemSchema.props.map((prop) => (
            <PropertyRow
              key={prop.name}
              name={prop.name}
              required={prop.required}
              $type={prop.$type}
              refs={refs}
              depth={depth + 1}
            />
          ))}
        </NestedBox>
      ) : null}
    </div>
  );
}

export function NestedSchemaUI({
  name,
  required = false,
  as = 'property',
  root,
  readOnly = false,
  writeOnly = false,
  showExample = false,
  getRawRef,
  processMarkdown,
}: NestedSchemaUIProps) {
  const generated = useMemo(
    () =>
      generateSchemaUI({
        root: root as never,
        readOnly,
        writeOnly,
        showExample,
        renderMarkdown: processMarkdown,
        renderCodeblock: ({ code }) => (
          <pre className="overflow-auto rounded-md border border-border bg-background p-2 text-xs">
            <code>{code}</code>
          </pre>
        ),
        resolver: (value) => ({
          dereferenced: value,
          $ref: typeof value === 'object' && value ? getRawRef(value) : undefined,
        }),
      }),
    [root, readOnly, writeOnly, showExample, getRawRef, processMarkdown],
  );

  const rootSchema = generated.refs[generated.$root];
  if (!rootSchema) return null;

  const showAsBody =
    as === 'body' && rootSchema.type === 'object' && rootSchema.props.length > 0;

  if (showAsBody) {
    return (
      <div className="schema-ui divide-y divide-border border-t border-border">
        {rootSchema.props.map((prop) => (
          <PropertyRow
            key={prop.name}
            name={prop.name}
            required={prop.required}
            $type={prop.$type}
            refs={generated.refs}
            depth={0}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="schema-ui border-t border-border">
      <PropertyRow
        name={name}
        required={required}
        $type={generated.$root}
        refs={generated.refs}
        depth={0}
      />
    </div>
  );
}
