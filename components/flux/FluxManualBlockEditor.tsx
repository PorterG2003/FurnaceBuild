import React, { type ReactNode } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { Block, BlockType, ContentAsset } from '@/lib/flux/types';
import type { FluxBlockEditorLayout } from '@/components/flux/fluxTemplateBlocksDraggableListShared';
import { fluxPanelInputClass, fluxPanelInputFieldClass, fluxPanelLabelClass } from '@/lib/flux/fluxEditorPanelClasses';
import {
  createQuizAndBookOption,
  createQuizAndBookQuestion,
  questionTypeLabel,
  questionTypeSupportsOptions,
  questionTypeSupportsPlaceholder,
  QUIZ_AND_BOOK_QUESTION_TYPES,
} from '@/lib/flux/fluxQuizAndBook';

export const FLUX_MANUAL_BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  hero: 'Hero',
  social_proof: 'Social Proof',
  case_study: 'Case Study',
  benefits: 'Benefits',
  testimonial: 'Testimonial',
  cta: 'CTA',
  tanners_tax_strategy: 'Tax strategy calculator',
  social_media_plan: 'Social media plan',
  competitor_ad_audit: 'Competitor ad audit',
  quiz_and_book: 'Quiz and book',
};

export const FLUX_ALL_BLOCK_TYPES: BlockType[] = [
  'hero',
  'social_proof',
  'case_study',
  'benefits',
  'testimonial',
  'cta',
  'tanners_tax_strategy',
  'social_media_plan',
  'competitor_ad_audit',
  'quiz_and_book',
];

export function fluxManualBlockSummary(block: Block): string {
  switch (block.type) {
    case 'hero':
      return block.props.headline || '(empty headline)';
    case 'social_proof':
      return `${block.props.logos.length} logos`;
    case 'case_study':
      return block.props.overrideTitle || `asset: ${block.props.assetId || '(none)'}`;
    case 'benefits':
      return `${block.props.items.length} items`;
    case 'testimonial':
      return block.props.overrideQuote?.slice(0, 40) || `asset: ${block.props.assetId || '(none)'}`;
    case 'cta':
      return block.props.headline || '(empty)';
    case 'tanners_tax_strategy':
      return block.props.heading || '(calculator)';
    case 'social_media_plan':
      return block.props.inferred_vertical || '(social plan)';
    case 'competitor_ad_audit':
      return `${block.props.heading?.trim() || 'Audit'} (${block.props.status})`;
    case 'quiz_and_book':
      return `${block.props.questions.length} steps`;
  }
}

export function renderFluxManualBlockEditor(
  block: Block,
  updateProps: (id: string, props: Record<string, unknown>) => void,
  assets: ContentAsset[],
  layout?: FluxBlockEditorLayout,
): ReactNode {
  const inputClass = fluxPanelInputClass;
  const labelClass = fluxPanelLabelClass;
  const pair = Boolean(layout?.pairFieldColumns);

  switch (block.type) {
    case 'hero':
      return (
        <View className="gap-1">
          <Text className={labelClass}>Headline</Text>
          <TextInput
            className={inputClass}
            value={block.props.headline}
            onChangeText={(value) => updateProps(block.id, { headline: value })}
            placeholder="Headline"
            placeholderTextColor="#555"
          />
          <Text className={labelClass}>Subheadline</Text>
          <TextInput
            className={inputClass}
            value={block.props.subheadline}
            onChangeText={(value) => updateProps(block.id, { subheadline: value })}
            placeholder="Subheadline"
            placeholderTextColor="#555"
            multiline
          />
          {pair ? (
            <View className="flex-row gap-2 flex-wrap mb-1.5">
              <View className="flex-1 min-w-[120px]">
                <Text className={labelClass}>CTA Text</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={block.props.ctaText}
                  onChangeText={(value) => updateProps(block.id, { ctaText: value })}
                  placeholder="CTA text"
                  placeholderTextColor="#555"
                />
              </View>
              <View className="flex-1 min-w-[120px]">
                <Text className={labelClass}>CTA URL</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={block.props.ctaUrl}
                  onChangeText={(value) => updateProps(block.id, { ctaUrl: value })}
                  placeholder="#section or https://…"
                  placeholderTextColor="#555"
                />
              </View>
            </View>
          ) : (
            <>
              <Text className={labelClass}>CTA Text</Text>
              <TextInput
                className={inputClass}
                value={block.props.ctaText}
                onChangeText={(value) => updateProps(block.id, { ctaText: value })}
                placeholder="CTA text"
                placeholderTextColor="#555"
              />
              <Text className={labelClass}>CTA URL</Text>
              <TextInput
                className={inputClass}
                value={block.props.ctaUrl}
                onChangeText={(value) => updateProps(block.id, { ctaUrl: value })}
                placeholder="#section or https://…"
                placeholderTextColor="#555"
              />
            </>
          )}
          <Text className={labelClass}>Hero image URL (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.heroImageUrl ?? ''}
            onChangeText={(value) =>
              updateProps(block.id, { heroImageUrl: value.trim() ? value.trim() : undefined })
            }
            placeholder="https://..."
            placeholderTextColor="#555"
            autoCapitalize="none"
          />
        </View>
      );
    case 'social_proof':
      return (
        <View className="gap-1">
          <Text className={labelClass}>Heading</Text>
          <TextInput
            className={inputClass}
            value={block.props.heading}
            onChangeText={(value) => updateProps(block.id, { heading: value })}
            placeholder="Trusted by"
            placeholderTextColor="#555"
          />
          <Text className={labelClass}>Logos (comma-separated names)</Text>
          <TextInput
            className={inputClass}
            value={block.props.logos.map((logo) => logo.name).join(', ')}
            onChangeText={(value) => {
              const names = value
                .split(',')
                .map((name) => name.trim())
                .filter(Boolean);
              const prevUrls = block.props.logos.map((l) => l.imageUrl?.trim() ?? '');
              const logos = names.map((name, i) => ({
                name,
                imageUrl: prevUrls[i] ? prevUrls[i] : undefined,
              }));
              updateProps(block.id, { logos });
            }}
            placeholder="Acme, Globex, Initech"
            placeholderTextColor="#555"
          />
          <Text className={labelClass}>
            Logo image URLs (optional, comma-separated — same order as names)
          </Text>
          <TextInput
            className={inputClass}
            value={block.props.logos.map((logo) => logo.imageUrl ?? '').join(', ')}
            onChangeText={(value) => {
              const urlParts = value.split(',').map((u) => u.trim());
              const logos = block.props.logos.map((logo, i) => ({
                ...logo,
                imageUrl: urlParts[i] ? urlParts[i] : undefined,
              }));
              updateProps(block.id, { logos });
            }}
            placeholder="https://…, https://…"
            placeholderTextColor="#555"
            autoCapitalize="none"
          />
        </View>
      );
    case 'case_study':
      return (
        <View className="gap-1">
          <Text className={labelClass}>Content Asset</Text>
          <View className="flex-row flex-wrap gap-1 mb-2">
            {assets
              .filter((asset) => asset.type === 'case_study')
              .map((asset) => (
                <Pressable
                  key={asset.id}
                  className={`px-2 py-1 rounded-lg ${
                    block.props.assetId === asset.id
                      ? 'bg-indigo-500/20 border border-indigo-500'
                      : 'bg-[#333] border border-[#444]'
                  }`}
                  onPress={() => updateProps(block.id, { assetId: asset.id })}
                >
                  <Text className="text-white text-xs">{asset.title}</Text>
                </Pressable>
              ))}
            {assets.filter((asset) => asset.type === 'case_study').length === 0 ? (
              <Text className="text-gray-500 text-xs">No case study assets. Add one above.</Text>
            ) : null}
          </View>
          {pair ? (
            <View className="flex-row gap-2 flex-wrap mb-1.5">
              <View className="flex-1 min-w-[120px]">
                <Text className={labelClass}>Override Title (optional)</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={block.props.overrideTitle || ''}
                  onChangeText={(value) => updateProps(block.id, { overrideTitle: value || undefined })}
                  placeholder="Override title"
                  placeholderTextColor="#555"
                />
              </View>
              <View className="flex-1 min-w-[120px]">
                <Text className={labelClass}>Override Metric (optional)</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={block.props.overrideMetric || ''}
                  onChangeText={(value) => updateProps(block.id, { overrideMetric: value || undefined })}
                  placeholder="Override metric"
                  placeholderTextColor="#555"
                />
              </View>
            </View>
          ) : (
            <>
              <Text className={labelClass}>Override Title (optional)</Text>
              <TextInput
                className={inputClass}
                value={block.props.overrideTitle || ''}
                onChangeText={(value) => updateProps(block.id, { overrideTitle: value || undefined })}
                placeholder="Override title"
                placeholderTextColor="#555"
              />
              <Text className={labelClass}>Override Metric (optional)</Text>
              <TextInput
                className={inputClass}
                value={block.props.overrideMetric || ''}
                onChangeText={(value) => updateProps(block.id, { overrideMetric: value || undefined })}
                placeholder="Override metric"
                placeholderTextColor="#555"
              />
            </>
          )}
        </View>
      );
    case 'benefits':
      return (
        <View className="gap-1">
          <Text className={labelClass}>Heading</Text>
          <TextInput
            className={inputClass}
            value={block.props.heading}
            onChangeText={(value) => updateProps(block.id, { heading: value })}
            placeholder="Benefits"
            placeholderTextColor="#555"
          />
          {block.props.items.map((item, index) => (
            <View key={index} className="flex-row gap-2 items-start">
              <View className="flex-1">
                <TextInput
                  className={inputClass}
                  value={item.title}
                  onChangeText={(value) => {
                    const items = [...block.props.items];
                    items[index] = { ...items[index], title: value };
                    updateProps(block.id, { items });
                  }}
                  placeholder={`Benefit ${index + 1} title`}
                  placeholderTextColor="#555"
                />
                <TextInput
                  className={inputClass}
                  value={item.description}
                  onChangeText={(value) => {
                    const items = [...block.props.items];
                    items[index] = { ...items[index], description: value };
                    updateProps(block.id, { items });
                  }}
                  placeholder="Description"
                  placeholderTextColor="#555"
                />
              </View>
              <Pressable
                className="mt-2"
                onPress={() =>
                  updateProps(block.id, {
                    items: block.props.items.filter((_, itemIndex) => itemIndex !== index),
                  })
                }
              >
                <Text className="text-red-400 text-sm">✕</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            className="border border-dashed border-[#444] rounded-lg p-2 items-center"
            onPress={() =>
              updateProps(block.id, {
                items: [...block.props.items, { title: '', description: '' }],
              })
            }
          >
            <Text className={labelClass}>+ Add benefit</Text>
          </Pressable>
        </View>
      );
    case 'testimonial':
      return (
        <View className="gap-1">
          <Text className={labelClass}>Content Asset</Text>
          <View className="flex-row flex-wrap gap-1 mb-2">
            {assets
              .filter((asset) => asset.type === 'testimonial')
              .map((asset) => (
                <Pressable
                  key={asset.id}
                  className={`px-2 py-1 rounded-lg ${
                    block.props.assetId === asset.id
                      ? 'bg-indigo-500/20 border border-indigo-500'
                      : 'bg-[#333] border border-[#444]'
                  }`}
                  onPress={() => updateProps(block.id, { assetId: asset.id })}
                >
                  <Text className="text-white text-xs">{asset.title}</Text>
                </Pressable>
              ))}
            {assets.filter((asset) => asset.type === 'testimonial').length === 0 ? (
              <Text className="text-gray-500 text-xs">No testimonial assets. Add one above.</Text>
            ) : null}
          </View>
          <Text className={labelClass}>Override Quote (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.overrideQuote || ''}
            onChangeText={(value) => updateProps(block.id, { overrideQuote: value || undefined })}
            placeholder="Override quote"
            placeholderTextColor="#555"
            multiline
          />
          <Text className={labelClass}>Override Attribution (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.overrideAttribution || ''}
            onChangeText={(value) =>
              updateProps(block.id, { overrideAttribution: value || undefined })
            }
            placeholder="Override attribution"
            placeholderTextColor="#555"
          />
        </View>
      );
    case 'cta':
      return (
        <View className="gap-1">
          <Text className={labelClass}>Headline</Text>
          <TextInput
            className={inputClass}
            value={block.props.headline}
            onChangeText={(value) => updateProps(block.id, { headline: value })}
            placeholder="Ready to get started?"
            placeholderTextColor="#555"
          />
          {pair ? (
            <View className="flex-row gap-2 flex-wrap mb-1.5">
              <View className="flex-1 min-w-[120px]">
                <Text className={labelClass}>CTA Text</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={block.props.ctaText}
                  onChangeText={(value) => updateProps(block.id, { ctaText: value })}
                  placeholder="Book a call"
                  placeholderTextColor="#555"
                />
              </View>
              <View className="flex-1 min-w-[120px]">
                <Text className={labelClass}>CTA URL</Text>
                <TextInput
                  className={`${fluxPanelInputFieldClass} w-full`}
                  value={block.props.ctaUrl}
                  onChangeText={(value) => updateProps(block.id, { ctaUrl: value })}
                  placeholder="#section or https://…"
                  placeholderTextColor="#555"
                />
              </View>
            </View>
          ) : (
            <>
              <Text className={labelClass}>CTA Text</Text>
              <TextInput
                className={inputClass}
                value={block.props.ctaText}
                onChangeText={(value) => updateProps(block.id, { ctaText: value })}
                placeholder="Book a call"
                placeholderTextColor="#555"
              />
              <Text className={labelClass}>CTA URL</Text>
              <TextInput
                className={inputClass}
                value={block.props.ctaUrl}
                onChangeText={(value) => updateProps(block.id, { ctaUrl: value })}
                placeholder="#section or https://…"
                placeholderTextColor="#555"
              />
            </>
          )}
        </View>
      );
    case 'quiz_and_book': {
      const props = block.props;
      const updateQuestion = (questionId: string, patch: Record<string, unknown>) => {
        updateProps(block.id, {
          questions: props.questions.map((question) =>
            question.id === questionId ? { ...question, ...patch } : question,
          ),
        });
      };
      const replaceQuestion = (questionId: string, buildNext: (question: typeof props.questions[number]) => typeof props.questions[number]) => {
        updateProps(block.id, {
          questions: props.questions.map((question) =>
            question.id === questionId ? buildNext(question) : question,
          ),
        });
      };
      return (
        <View className="gap-2">
          <Text className={labelClass}>Heading</Text>
          <TextInput
            className={inputClass}
            value={props.heading}
            onChangeText={(value) => updateProps(block.id, { heading: value })}
            placeholder="A few quick questions before we build your plan."
            placeholderTextColor="#555"
            multiline
          />
          <Text className={labelClass}>Subheading</Text>
          <TextInput
            className={inputClass}
            value={props.subheading}
            onChangeText={(value) => updateProps(block.id, { subheading: value })}
            placeholder="Explain the value of the quiz in one short paragraph."
            placeholderTextColor="#555"
            multiline
          />
          <Text className={labelClass}>Calendly URL</Text>
          <TextInput
            className={inputClass}
            value={props.calendlyUrl}
            onChangeText={(value) => updateProps(block.id, { calendlyUrl: value })}
            placeholder="https://calendly.com/..."
            placeholderTextColor="#555"
            autoCapitalize="none"
          />
          <Text className={labelClass}>Destination Email (optional)</Text>
          <TextInput
            className={inputClass}
            value={props.destinationEmail ?? ''}
            onChangeText={(value) =>
              updateProps(block.id, { destinationEmail: value.trim() ? value.trim() : undefined })
            }
            placeholder="team@example.com"
            placeholderTextColor="#555"
            autoCapitalize="none"
          />
          <Text className={labelClass}>Summary heading</Text>
          <TextInput
            className={inputClass}
            value={props.summaryHeading}
            onChangeText={(value) => updateProps(block.id, { summaryHeading: value })}
            placeholder="Perfect."
            placeholderTextColor="#555"
          />
          <Text className={labelClass}>Summary body</Text>
          <TextInput
            className={inputClass}
            value={props.summaryBody}
            onChangeText={(value) => updateProps(block.id, { summaryBody: value })}
            placeholder="Next step is scheduling our meeting..."
            placeholderTextColor="#555"
            multiline
          />

          <View className="gap-3 mt-2">
            {props.questions.map((question, questionIndex) => (
              <View key={question.id} className="border border-[#333] rounded-lg p-3 gap-2">
                <View className="flex-row flex-wrap items-center justify-between gap-2">
                  <Text className="text-gray-300 text-xs font-instrument-semibold">
                    Step {questionIndex + 1}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Pressable
                      className="px-2 py-1 rounded border border-[#444] bg-[#2A2A2A]"
                      disabled={questionIndex === 0}
                      onPress={() => {
                        if (questionIndex === 0) return;
                        const next = [...props.questions];
                        const [moved] = next.splice(questionIndex, 1);
                        next.splice(questionIndex - 1, 0, moved!);
                        updateProps(block.id, { questions: next });
                      }}
                    >
                      <Text className="text-gray-300 text-[11px]">Up</Text>
                    </Pressable>
                    <Pressable
                      className="px-2 py-1 rounded border border-[#444] bg-[#2A2A2A]"
                      disabled={questionIndex === props.questions.length - 1}
                      onPress={() => {
                        if (questionIndex === props.questions.length - 1) return;
                        const next = [...props.questions];
                        const [moved] = next.splice(questionIndex, 1);
                        next.splice(questionIndex + 1, 0, moved!);
                        updateProps(block.id, { questions: next });
                      }}
                    >
                      <Text className="text-gray-300 text-[11px]">Down</Text>
                    </Pressable>
                    <Pressable
                      className="px-2 py-1 rounded border border-red-500/40 bg-red-500/10"
                      onPress={() =>
                        updateProps(block.id, {
                          questions: props.questions.filter((candidate) => candidate.id !== question.id),
                        })
                      }
                    >
                      <Text className="text-red-300 text-[11px]">Remove</Text>
                    </Pressable>
                  </View>
                </View>

                <Text className={labelClass}>Question type</Text>
                <View className="flex-row flex-wrap gap-2">
                  {QUIZ_AND_BOOK_QUESTION_TYPES.map((type) => (
                    <Pressable
                      key={type}
                      className={`px-2 py-1 rounded-lg border ${
                        question.type === type
                          ? 'border-indigo-500 bg-indigo-500/20'
                          : 'border-[#444] bg-[#333]'
                      }`}
                      onPress={() => {
                        const next =
                          type === question.type
                            ? question
                            : {
                                ...createQuizAndBookQuestion(type, question.prompt || 'Question'),
                                id: question.id,
                                prompt: question.prompt,
                                helperText: question.helperText,
                                required: question.required,
                              };
                        replaceQuestion(question.id, () => next);
                      }}
                    >
                      <Text className="text-white text-xs">{questionTypeLabel(type)}</Text>
                    </Pressable>
                  ))}
                </View>

                <Text className={labelClass}>Prompt</Text>
                <TextInput
                  className={inputClass}
                  value={question.prompt}
                  onChangeText={(value) => updateQuestion(question.id, { prompt: value })}
                  placeholder="What do you want to ask?"
                  placeholderTextColor="#555"
                  multiline
                />
                <Text className={labelClass}>Helper text (optional)</Text>
                <TextInput
                  className={inputClass}
                  value={question.helperText ?? ''}
                  onChangeText={(value) =>
                    updateQuestion(question.id, { helperText: value.trim() ? value : undefined })
                  }
                  placeholder="Optional supporting copy"
                  placeholderTextColor="#555"
                  multiline
                />
                <View className="flex-row flex-wrap gap-2 items-center">
                  <Text className={labelClass}>Required</Text>
                  <Pressable
                    className={`px-2 py-1 rounded-lg border ${
                      question.required !== false
                        ? 'border-indigo-500 bg-indigo-500/20'
                        : 'border-[#444] bg-[#333]'
                    }`}
                    onPress={() =>
                      updateQuestion(question.id, { required: question.required === false ? true : false })
                    }
                  >
                    <Text className="text-white text-xs">
                      {question.required === false ? 'Optional' : 'Required'}
                    </Text>
                  </Pressable>
                </View>

                {questionTypeSupportsPlaceholder(question.type) ? (
                  <>
                    <Text className={labelClass}>Placeholder (optional)</Text>
                    <TextInput
                      className={inputClass}
                      value={question.placeholder ?? ''}
                      onChangeText={(value) =>
                        updateQuestion(question.id, { placeholder: value.trim() ? value : undefined })
                      }
                      placeholder="Type your answer..."
                      placeholderTextColor="#555"
                    />
                  </>
                ) : null}

                {questionTypeSupportsOptions(question.type) ? (
                  <View className="gap-2">
                    <Text className={labelClass}>Answer options</Text>
                    {(question.options ?? []).map((option, optionIndex) => (
                      <View key={option.id} className="flex-row gap-2 items-center">
                        <TextInput
                          className={`${fluxPanelInputFieldClass} flex-1`}
                          value={option.label}
                          onChangeText={(value) =>
                            replaceQuestion(question.id, (currentQuestion) => ({
                              ...currentQuestion,
                              options: (currentQuestion.options ?? []).map((currentOption) =>
                                currentOption.id === option.id
                                  ? { ...currentOption, label: value }
                                  : currentOption,
                              ),
                            }))
                          }
                          placeholder={`Option ${optionIndex + 1}`}
                          placeholderTextColor="#555"
                        />
                        <Pressable
                          className="px-2 py-1 rounded border border-[#444] bg-[#2A2A2A]"
                          disabled={optionIndex === 0}
                          onPress={() =>
                            replaceQuestion(question.id, (currentQuestion) => {
                              const nextOptions = [...(currentQuestion.options ?? [])];
                              const [moved] = nextOptions.splice(optionIndex, 1);
                              nextOptions.splice(optionIndex - 1, 0, moved!);
                              return { ...currentQuestion, options: nextOptions };
                            })
                          }
                        >
                          <Text className="text-gray-300 text-[11px]">Up</Text>
                        </Pressable>
                        <Pressable
                          className="px-2 py-1 rounded border border-red-500/40 bg-red-500/10"
                          onPress={() =>
                            replaceQuestion(question.id, (currentQuestion) => ({
                              ...currentQuestion,
                              options: (currentQuestion.options ?? []).filter(
                                (currentOption) => currentOption.id !== option.id,
                              ),
                            }))
                          }
                        >
                          <Text className="text-red-300 text-[11px]">Remove</Text>
                        </Pressable>
                      </View>
                    ))}
                    <Pressable
                      className="border border-dashed border-[#444] rounded-lg p-2 items-center"
                      onPress={() =>
                        replaceQuestion(question.id, (currentQuestion) => ({
                          ...currentQuestion,
                          options: [...(currentQuestion.options ?? []), createQuizAndBookOption('New option')],
                        }))
                      }
                    >
                      <Text className={labelClass}>+ Add option</Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ))}

            <View className="flex-row flex-wrap gap-2">
              {QUIZ_AND_BOOK_QUESTION_TYPES.map((type) => (
                <Pressable
                  key={type}
                  className="border border-dashed border-[#444] rounded-lg px-3 py-2"
                  onPress={() =>
                    updateProps(block.id, {
                      questions: [...props.questions, createQuizAndBookQuestion(type, `Question ${props.questions.length + 1}`)],
                    })
                  }
                >
                  <Text className="text-gray-300 text-xs">+ {questionTypeLabel(type)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      );
    }
    case 'social_media_plan': {
      const props = block.props;
      return (
        <View className="gap-2">
          <Text className={labelClass}>Inferred vertical</Text>
          <TextInput
            className={inputClass}
            value={props.inferred_vertical}
            onChangeText={(value) => updateProps(block.id, { inferred_vertical: value })}
            placeholder="e.g. med spas"
            placeholderTextColor="#555"
          />
          <Text className={labelClass}>Vertical rationale</Text>
          <TextInput
            className={inputClass}
            value={props.inferred_vertical_rationale}
            onChangeText={(value) => updateProps(block.id, { inferred_vertical_rationale: value })}
            placeholder="Why this vertical (honest)"
            placeholderTextColor="#555"
            multiline
          />
          <Text className={labelClass}>Positioning summary</Text>
          <TextInput
            className={inputClass}
            value={props.positioning_summary}
            onChangeText={(value) => updateProps(block.id, { positioning_summary: value })}
            placeholder="How this vertical should sound on social"
            placeholderTextColor="#555"
            multiline
          />
          <Text className={labelClass}>Platform mix note</Text>
          <TextInput
            className={inputClass}
            value={props.platform_mix_note}
            onChangeText={(value) => updateProps(block.id, { platform_mix_note: value })}
            placeholder="One line on IG / TikTok / FB split"
            placeholderTextColor="#555"
          />
          <Text className={labelClass}>CTA ladder (one per line)</Text>
          <TextInput
            className={inputClass}
            value={props.cta_ladder.join('\n')}
            onChangeText={(value) =>
              updateProps(block.id, {
                cta_ladder: value.split('\n').map((s) => s.trim()).filter(Boolean),
              })
            }
            placeholder={'Follow\nDM KEYWORD\nBook consult'}
            placeholderTextColor="#555"
            multiline
          />
          {props.weeks.map((week, wi) => (
            <View key={wi} className="border border-[#333] rounded-lg p-3 gap-2">
              <Text className="text-gray-300 text-xs font-instrument-semibold">Week {wi + 1} theme</Text>
              <TextInput
                className={inputClass}
                value={week.theme}
                onChangeText={(value) => {
                  const weeks = [...props.weeks];
                  weeks[wi] = { ...weeks[wi]!, theme: value };
                  updateProps(block.id, { weeks });
                }}
                placeholder="Week theme"
                placeholderTextColor="#555"
              />
              {week.days.map((day, di) => (
                <View key={di} className="border border-[#2A2A2A] rounded-md p-2 gap-1">
                  <View className="flex-row justify-between items-center mb-1">
                    <Text className="text-gray-500 text-[10px] uppercase">Day {di + 1}</Text>
                    <Pressable
                      onPress={() => {
                        const weeks = [...props.weeks];
                        const w = { ...weeks[wi]!, days: week.days.filter((_, j) => j !== di) };
                        weeks[wi] = w;
                        updateProps(block.id, { weeks });
                      }}
                    >
                      <Text className="text-red-400 text-xs">Remove day</Text>
                    </Pressable>
                  </View>
                  <TextInput
                    className={inputClass}
                    value={day.platform}
                    onChangeText={(value) => {
                      const weeks = [...props.weeks];
                      const days = [...week.days];
                      days[di] = { ...days[di]!, platform: value };
                      weeks[wi] = { ...weeks[wi]!, days };
                      updateProps(block.id, { weeks });
                    }}
                    placeholder="IG / TikTok / FB"
                    placeholderTextColor="#555"
                  />
                  <TextInput
                    className={inputClass}
                    value={day.post_type}
                    onChangeText={(value) => {
                      const weeks = [...props.weeks];
                      const days = [...week.days];
                      days[di] = { ...days[di]!, post_type: value };
                      weeks[wi] = { ...weeks[wi]!, days };
                      updateProps(block.id, { weeks });
                    }}
                    placeholder="Reel, carousel, …"
                    placeholderTextColor="#555"
                  />
                  <TextInput
                    className={inputClass}
                    value={day.hook}
                    onChangeText={(value) => {
                      const weeks = [...props.weeks];
                      const days = [...week.days];
                      days[di] = { ...days[di]!, hook: value };
                      weeks[wi] = { ...weeks[wi]!, days };
                      updateProps(block.id, { weeks });
                    }}
                    placeholder="Hook"
                    placeholderTextColor="#555"
                    multiline
                  />
                  <TextInput
                    className={inputClass}
                    value={day.cta ?? ''}
                    onChangeText={(value) => {
                      const weeks = [...props.weeks];
                      const days = [...week.days];
                      days[di] = { ...days[di]!, cta: value.trim() ? value : undefined };
                      weeks[wi] = { ...weeks[wi]!, days };
                      updateProps(block.id, { weeks });
                    }}
                    placeholder="CTA (optional)"
                    placeholderTextColor="#555"
                  />
                </View>
              ))}
              <Pressable
                className="border border-dashed border-[#444] rounded-lg p-2 items-center"
                onPress={() => {
                  const weeks = [...props.weeks];
                  weeks[wi] = {
                    ...weeks[wi]!,
                    days: [
                      ...week.days,
                      { platform: '', post_type: '', hook: '' },
                    ],
                  };
                  updateProps(block.id, { weeks });
                }}
              >
                <Text className={labelClass}>+ Add day</Text>
              </Pressable>
              <Pressable
                className="mt-1"
                onPress={() =>
                  updateProps(block.id, {
                    weeks: props.weeks.filter((_, j) => j !== wi),
                  })
                }
              >
                <Text className="text-red-400 text-xs">Remove week {wi + 1}</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            className="border border-dashed border-[#444] rounded-lg p-2 items-center"
            onPress={() =>
              updateProps(block.id, {
                weeks: [
                  ...props.weeks,
                  { theme: '', days: [{ platform: '', post_type: '', hook: '' }] },
                ],
              })
            }
          >
            <Text className={labelClass}>+ Add week</Text>
          </Pressable>
        </View>
      );
    }
    case 'competitor_ad_audit': {
      const p = block.props;
      return (
        <View className="gap-1">
          <Text className={labelClass}>Section heading</Text>
          <TextInput
            className={inputClass}
            value={p.heading}
            onChangeText={(value) => updateProps(block.id, { heading: value })}
            placeholder="Competitor ad audit"
            placeholderTextColor="#555"
          />
          <Text className="text-gray-500 text-xs font-instrument mt-2">
            Status: {p.status}
            {p.lastAuditAt ? ` · Last run: ${p.lastAuditAt}` : ''}
          </Text>
          {p.errorMessage ? (
            <Text className="text-red-400 text-xs font-instrument">{p.errorMessage}</Text>
          ) : null}
          <Text className="text-gray-500 text-xs font-instrument leading-5 mt-1">
            Maps and ad samples are produced by the audit. Set the prospect service area, save the prospect,
            then use Run competitor audit on the prospect page.
          </Text>
        </View>
      );
    }
    case 'tanners_tax_strategy':
      return (
        <View className="gap-1">
          <Text className={labelClass}>Heading</Text>
          <TextInput
            className={inputClass}
            value={block.props.heading}
            onChangeText={(value) => updateProps(block.id, { heading: value })}
            placeholder="Heading"
            placeholderTextColor="#555"
          />
          <Text className={labelClass}>Subheadline (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.subheadline || ''}
            onChangeText={(value) => updateProps(block.id, { subheadline: value || undefined })}
            placeholder="Short intro"
            placeholderTextColor="#555"
            multiline
          />
          <Text className={labelClass}>Disclaimer</Text>
          <TextInput
            className={inputClass}
            value={block.props.disclaimer}
            onChangeText={(value) => updateProps(block.id, { disclaimer: value })}
            placeholder="Legal disclaimer"
            placeholderTextColor="#555"
            multiline
          />
          <Text className={labelClass}>Default purchase price</Text>
          <TextInput
            className={inputClass}
            value={
              block.props.defaultPurchasePrice != null ? String(block.props.defaultPurchasePrice) : ''
            }
            onChangeText={(value) => {
              const parsed = parseFloat(value.replace(/,/g, ''));
              updateProps(block.id, {
                defaultPurchasePrice:
                  value.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed,
              });
            }}
            placeholder="500000"
            placeholderTextColor="#555"
            keyboardType="decimal-pad"
          />
          <Text className={labelClass}>Default land value</Text>
          <TextInput
            className={inputClass}
            value={block.props.defaultLandValue != null ? String(block.props.defaultLandValue) : ''}
            onChangeText={(value) => {
              const parsed = parseFloat(value.replace(/,/g, ''));
              updateProps(block.id, {
                defaultLandValue:
                  value.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed,
              });
            }}
            placeholder="150000"
            placeholderTextColor="#555"
            keyboardType="decimal-pad"
          />
          <Text className={labelClass}>Default marginal tax %</Text>
          <TextInput
            className={inputClass}
            value={
              block.props.defaultMarginalTaxPercent != null
                ? String(block.props.defaultMarginalTaxPercent)
                : ''
            }
            onChangeText={(value) => {
              const parsed = parseFloat(value.replace(/,/g, ''));
              updateProps(block.id, {
                defaultMarginalTaxPercent:
                  value.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed,
              });
            }}
            placeholder="37"
            placeholderTextColor="#555"
            keyboardType="decimal-pad"
          />
          <Text className="text-gray-400 text-xs mb-1">Default qualification mode</Text>
          <View className="flex-row flex-wrap gap-2 mb-2">
            {(['passive', 'reps', 'str'] as const).map((mode) => (
              <Pressable
                key={mode}
                className={`px-2 py-1 rounded-lg border ${
                  (block.props.defaultQualificationMode ?? 'passive') === mode
                    ? 'border-indigo-500 bg-indigo-500/20'
                    : 'border-[#444] bg-[#333]'
                }`}
                onPress={() => updateProps(block.id, { defaultQualificationMode: mode })}
              >
                <Text className="text-white text-xs">{mode}</Text>
              </Pressable>
            ))}
          </View>
          <Text className={labelClass}>CTA text (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.ctaText || ''}
            onChangeText={(value) => updateProps(block.id, { ctaText: value || undefined })}
            placeholder="Book a call"
            placeholderTextColor="#555"
          />
          <Text className={labelClass}>CTA URL (optional)</Text>
          <TextInput
            className={inputClass}
            value={block.props.ctaUrl || ''}
            onChangeText={(value) => updateProps(block.id, { ctaUrl: value || undefined })}
            placeholder="#section or https://…"
            placeholderTextColor="#555"
          />
        </View>
      );
    default:
      return null;
  }
}
