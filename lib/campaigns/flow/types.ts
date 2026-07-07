import type { EmailEditorMode } from '../../email/emailHtmlMode.js';
import type { EmailNodeVariant } from '../../email/emailNodeVariants.js';

export type CampaignStatus = 'draft' | 'running' | 'paused' | 'stopped';

export type FlowNodeType =
  | 'leadSource'
  | 'email'
  | 'waitTime'
  | 'aiCategorizer'
  | 'dataSender';

export type FlowChangeKind = 'none' | 'content' | 'structural';

export type FlowValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export type FlowValidationResult = {
  issues: FlowValidationIssue[];
};

export type FlowPosition = {
  x: number;
  y: number;
};

export type FlowNodeBase<TType extends FlowNodeType, TData extends Record<string, unknown>> = {
  id: string;
  type: TType;
  position: FlowPosition;
  data: TData;
  deletable?: boolean;
};

export type LeadSourceNodeData = {
  label?: string;
  source?: string;
  bucketId?: string;
  customFieldKeys?: string[];
  mappedStandardFieldKeys?: string[];
  isRequired?: boolean;
} & Record<string, unknown>;

export type EmailNodeData = {
  label?: string;
  mailboxId?: string;
  send_mode?: 'new' | 'reply';
  variants: EmailNodeVariant[];
  subject?: string;
  template?: string;
  body_html?: string;
  body_text?: string;
  editor_mode?: EmailEditorMode;
} & Record<string, unknown>;

export type WaitTimeNodeData = {
  label?: string;
  duration?: string;
  unit?: 'minutes' | 'hours' | 'days';
  wait_duration_seconds?: number;
} & Record<string, unknown>;

export type AICategorizerNodeData = {
  label?: string;
  use_ai?: boolean;
} & Record<string, unknown>;

export type DataSenderNodeData = {
  label?: string;
  endpoint?: string;
  endpoint_url?: string;
  payload?: string;
  payload_template?: Record<string, unknown>;
  on_failure?: 'continue' | 'stop';
} & Record<string, unknown>;

export type LeadSourceFlowNode = FlowNodeBase<'leadSource', LeadSourceNodeData>;
export type EmailFlowNode = FlowNodeBase<'email', EmailNodeData>;
export type WaitTimeFlowNode = FlowNodeBase<'waitTime', WaitTimeNodeData>;
export type AICategorizerFlowNode = FlowNodeBase<'aiCategorizer', AICategorizerNodeData>;
export type DataSenderFlowNode = FlowNodeBase<'dataSender', DataSenderNodeData>;

export type CampaignFlowNode =
  | LeadSourceFlowNode
  | EmailFlowNode
  | WaitTimeFlowNode
  | AICategorizerFlowNode
  | DataSenderFlowNode;

export type CampaignFlowEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  type?: string;
} & Record<string, unknown>;

export type CampaignFlowData = {
  nodes: CampaignFlowNode[];
  edges: CampaignFlowEdge[];
};

export type FlowEditPolicy = {
  allowed: boolean;
  code?: 'flow_locked';
  message?: string;
};
