import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { QuizAndBookBlockProps, QuizAndBookQuestion } from '@/lib/flux/types';
import {
  formatQuizAndBookAnswer,
  questionTypeSupportsOptions,
  type QuizAndBookResponseValue,
} from '@/lib/flux/fluxQuizAndBook';
import { submitFluxQuizSubmission } from '@/lib/services/fluxQuizSubmission';
import { fluxPreviewFontFamily } from '@/lib/flux/fluxPreviewFontFamily';
import { useFluxPresentation, useFluxTheme } from '../FluxThemeProvider';
import type { FluxBlockRuntimeContext } from './BlockRenderer';

function buildCalendlyUrl(baseUrl: string, runtimeContext?: FluxBlockRuntimeContext): string {
  try {
    const url = new URL(baseUrl);
    const name = runtimeContext?.prospectName?.trim();
    if (name && !url.searchParams.get('name')) {
      url.searchParams.set('name', name);
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

export function QuizAndBookBlock({
  props,
  runtimeContext,
  blockId,
}: {
  props: QuizAndBookBlockProps;
  runtimeContext?: FluxBlockRuntimeContext;
  blockId: string;
}) {
  const theme = useFluxTheme();
  const presentation = useFluxPresentation();
  const headingFont = fluxPreviewFontFamily(theme.fontFamily, '600');
  const bodyFont = fluxPreviewFontFamily(theme.fontFamily, '400');
  const [started, setStarted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuizAndBookResponseValue>>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const questionCount = props.questions.length;
  const currentQuestion = stepIndex < questionCount ? props.questions[stepIndex] : null;
  const isSummary = started && stepIndex === questionCount;
  const isBooking = started && stepIndex > questionCount;
  const calendlyUrl = useMemo(
    () => buildCalendlyUrl(props.calendlyUrl, runtimeContext),
    [props.calendlyUrl, runtimeContext],
  );

  const answerRows = props.questions
    .map((question) => ({
      question,
      value: formatQuizAndBookAnswer(question, answers[question.id]),
    }))
    .filter((row) => row.value.trim().length > 0);

  function setAnswer(questionId: string, value: QuizAndBookResponseValue) {
    setAnswers((current) => ({ ...current, [questionId]: value }));
    setValidationError(null);
    setSubmissionError(null);
  }

  function toggleMulti(question: QuizAndBookQuestion, optionId: string) {
    const current: string[] = Array.isArray(answers[question.id]) ? answers[question.id] : [];
    const selected = current.includes(optionId)
      ? current.filter((value) => value !== optionId)
      : [...current, optionId];
    setAnswer(question.id, selected);
  }

  function validateQuestion(question: QuizAndBookQuestion): boolean {
    if (question.required === false) return true;
    const answer = answers[question.id];
    if (Array.isArray(answer)) return answer.length > 0;
    return typeof answer === 'string' && answer.trim().length > 0;
  }

  function advanceStep() {
    setStepIndex((current) => current + 1);
    setValidationError(null);
  }

  function handleNext() {
    if (currentQuestion && !validateQuestion(currentQuestion)) {
      setValidationError('Please select an answer before continuing.');
      return;
    }
    advanceStep();
  }

  async function continueFromSummary() {
    setSubmissionError(null);
    if (runtimeContext?.isPublicPage && runtimeContext.pageSlug && !submitted) {
      try {
        setSending(true);
        await submitFluxQuizSubmission({
          slug: runtimeContext.pageSlug,
          blockId,
          answers,
        });
        setSubmitted(true);
      } catch (error) {
        setSubmissionError(error instanceof Error ? error.message : 'Failed to send quiz answers.');
        return;
      } finally {
        setSending(false);
      }
    }
    setStepIndex(questionCount + 1);
  }

  function renderOptionQuestion(question: QuizAndBookQuestion) {
    const selectedValue = answers[question.id];
    const isMulti = question.type === 'multi_select';
    return (
      <View className="gap-2.5">
        {(question.options ?? []).map((option) => {
          const selected = Array.isArray(selectedValue)
            ? selectedValue.includes(option.id)
            : selectedValue === option.id;
          return (
            <Pressable
              key={option.id}
              className="flex-row items-center gap-4 px-4 py-4 rounded-2xl border"
              style={{
                borderColor: selected ? theme.primaryColor : `${theme.primaryColor}28`,
                backgroundColor: selected ? `${theme.primaryColor}12` : 'transparent',
              }}
              onPress={() => {
                if (isMulti) {
                  toggleMulti(question, option.id);
                } else {
                  setAnswer(question.id, option.id);
                }
              }}
            >
              <View
                className="items-center justify-center"
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: isMulti ? 6 : 11,
                  borderWidth: 2,
                  borderColor: selected ? theme.primaryColor : `${theme.primaryColor}44`,
                  backgroundColor: selected ? theme.primaryColor : 'transparent',
                  flexShrink: 0,
                }}
              >
                {selected ? (
                  <Text
                    style={{ color: presentation.onPrimaryColor, fontSize: 12, fontFamily: headingFont }}
                  >
                    {isMulti ? '✓' : '●'}
                  </Text>
                ) : null}
              </View>
              <Text
                className="flex-1 text-base leading-6"
                style={{
                  color: theme.textColor,
                  fontFamily: selected ? headingFont : bodyFont,
                  opacity: selected ? 1 : 0.85,
                }}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }

  function renderTextQuestion(question: QuizAndBookQuestion) {
    const multiline = question.type === 'textarea';
    return (
      <TextInput
        className="rounded-2xl px-4 text-base"
        style={{
          color: theme.textColor,
          minHeight: multiline ? 140 : 56,
          textAlignVertical: multiline ? 'top' : 'center',
          paddingTop: multiline ? 14 : 0,
          fontFamily: bodyFont,
          borderWidth: 1.5,
          borderColor: `${theme.primaryColor}44`,
          borderRadius: 16,
          backgroundColor: `${theme.primaryColor}08`,
        }}
        multiline={multiline}
        placeholder={question.placeholder || (multiline ? 'Type your response...' : 'Your answer')}
        placeholderTextColor={`${theme.textColor}55`}
        value={typeof answers[question.id] === 'string' ? (answers[question.id] as string) : ''}
        onChangeText={(value) => setAnswer(question.id, value)}
      />
    );
  }

  function renderQuestionContent() {
    if (!currentQuestion) return null;
    return (
      <View className="gap-4">
        <View className="gap-1.5">
          <Text
            className="text-xl md:text-2xl leading-snug"
            style={{ color: theme.textColor, fontFamily: headingFont }}
          >
            {currentQuestion.prompt}
          </Text>
          {currentQuestion.helperText ? (
            <Text
              className="text-sm md:text-base leading-6"
              style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: bodyFont }}
            >
              {currentQuestion.helperText}
            </Text>
          ) : null}
        </View>
        {questionTypeSupportsOptions(currentQuestion.type)
          ? renderOptionQuestion(currentQuestion)
          : renderTextQuestion(currentQuestion)}
      </View>
    );
  }

  function renderSummary() {
    return (
      <View className="gap-5">
        <View className="gap-2">
          <Text
            className="text-xl md:text-2xl"
            style={{ color: theme.textColor, fontFamily: headingFont }}
          >
            {props.summaryHeading}
          </Text>
          <Text
            className="text-base leading-7"
            style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: bodyFont }}
          >
            {props.summaryBody}
          </Text>
        </View>
        {answerRows.length > 0 ? (
          <View
            className="rounded-2xl overflow-hidden"
            style={{ borderWidth: 1, borderColor: `${theme.primaryColor}20` }}
          >
            {answerRows.map((row, i) => (
              <View
                key={row.question.id}
                className="px-4 py-3"
                style={{
                  backgroundColor: i % 2 === 0 ? `${theme.primaryColor}08` : 'transparent',
                  borderTopWidth: i > 0 ? 1 : 0,
                  borderTopColor: `${theme.primaryColor}14`,
                }}
              >
                <Text
                  className="text-xs mb-0.5"
                  style={{ color: theme.textColor, opacity: 0.5, fontFamily: bodyFont }}
                >
                  {row.question.prompt}
                </Text>
                <Text
                  className="text-sm"
                  style={{ color: theme.textColor, fontFamily: headingFont }}
                >
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {!runtimeContext?.isPublicPage ? (
          <Text
            className="text-xs leading-5"
            style={{ color: theme.textColor, opacity: 0.5, fontFamily: bodyFont }}
          >
            Preview mode — submission emails only send from the live public page.
          </Text>
        ) : null}
      </View>
    );
  }

  function renderBooking() {
    const embedFrame =
      Platform.OS === 'web'
        ? React.createElement('iframe', {
            src: calendlyUrl,
            style: {
              width: '100%',
              minHeight: 700,
              border: '0',
              backgroundColor: 'transparent',
            },
            title: props.heading || 'Calendly booking',
          })
        : (
          <WebView
            source={{ uri: calendlyUrl }}
            style={{ minHeight: 700, backgroundColor: 'transparent' }}
            originWhitelist={['*']}
          />
        );

    return (
      <View className="gap-4">
        <View className="gap-2">
          <Text
            className="text-xl md:text-2xl"
            style={{ color: theme.textColor, fontFamily: headingFont }}
          >
            Pick a time that works
          </Text>
          <Text
            className="text-sm md:text-base leading-6"
            style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: bodyFont }}
          >
            Choose a slot and we&apos;ll walk through your strategy together.
          </Text>
        </View>
        <View className="overflow-hidden rounded-2xl" style={{ borderWidth: 1, borderColor: `${theme.primaryColor}18` }}>
          {embedFrame}
        </View>
        <Pressable
          className="self-start px-4 py-2"
          onPress={() => { void Linking.openURL(calendlyUrl); }}
        >
          <Text
            className="text-sm"
            style={{ color: theme.primaryColor, fontFamily: bodyFont, textDecorationLine: 'underline' }}
          >
            Open in Calendly
          </Text>
        </Pressable>
      </View>
    );
  }

  // ── Intro screen ────────────────────────────────────────────────────────────
  if (!started) {
    return (
      <View className="w-full px-4 md:px-6 py-10 md:py-14" style={{ backgroundColor: theme.backgroundColor }}>
        <View className="w-full max-w-2xl self-center">
          <View className="rounded-3xl px-6 md:px-10 py-8 md:py-10 gap-6" style={presentation.strongCard}>
            <View className="gap-3">
              {props.heading ? (
                <Text
                  className="text-2xl md:text-3xl leading-snug"
                  style={{ color: theme.textColor, fontFamily: headingFont }}
                >
                  {props.heading}
                </Text>
              ) : null}
              {props.subheading ? (
                <Text
                  className="text-base md:text-lg leading-7"
                  style={{ color: theme.textColor, opacity: presentation.mutedTextOpacity, fontFamily: bodyFont }}
                >
                  {props.subheading}
                </Text>
              ) : null}
            </View>
            <Pressable
              className="w-full items-center py-4 rounded-2xl"
              style={presentation.primaryButton}
              onPress={() => setStarted(true)}
            >
              <Text
                className="text-base"
                style={{ color: presentation.onPrimaryColor, fontFamily: headingFont }}
              >
                Get started
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // ── Quiz / summary / booking ─────────────────────────────────────────────
  return (
    <View className="w-full px-4 md:px-6 py-10 md:py-14" style={{ backgroundColor: theme.backgroundColor }}>
      <View className="w-full max-w-2xl self-center">
        <View className="rounded-3xl overflow-hidden" style={presentation.strongCard}>
          {/* Step header with eyebrow + progress bar */}
          <View
            className="px-6 md:px-8 pt-6 md:pt-7 pb-5"
            style={{ borderBottomWidth: 1, borderBottomColor: `${theme.primaryColor}14` }}
          >
            <Text
              className="text-xs uppercase tracking-[2px] mb-3"
              style={{ color: theme.primaryColor, fontFamily: headingFont }}
            >
              {isSummary
                ? 'Almost done'
                : isBooking
                ? 'Book a time'
                : `Question ${stepIndex + 1} of ${questionCount}`}
            </Text>
            <View className="flex-row gap-1.5">
              {Array.from({ length: questionCount + 2 }, (_, index) => {
                const complete = index < stepIndex;
                const active = index === stepIndex;
                return (
                  <View
                    key={index}
                    className="h-1 flex-1 rounded-full"
                    style={{
                      backgroundColor:
                        active ? theme.primaryColor
                        : complete ? `${theme.primaryColor}66`
                        : `${theme.primaryColor}20`,
                    }}
                  />
                );
              })}
            </View>
          </View>

          {/* Step content */}
          <View className="px-6 md:px-8 pt-6 pb-5">
            {!isSummary && !isBooking ? renderQuestionContent() : null}
            {isSummary ? renderSummary() : null}
            {isBooking ? renderBooking() : null}
          </View>

          {/* Footer navigation — hidden on booking step */}
          {!isBooking ? (
            <View
              className="px-6 md:px-8 pb-6 md:pb-8 pt-4 gap-3"
              style={{ borderTopWidth: 1, borderTopColor: `${theme.primaryColor}14` }}
            >
              {(validationError || submissionError) ? (
                <Text className="text-sm" style={{ color: presentation.errorColor, fontFamily: bodyFont }}>
                  {validationError ?? submissionError}
                </Text>
              ) : null}

              {!isSummary ? (
                <Pressable
                  className="w-full items-center py-4 rounded-2xl"
                  style={presentation.primaryButton}
                  onPress={handleNext}
                >
                  <Text
                className="text-base"
                style={{ color: presentation.onPrimaryColor, fontFamily: headingFont }}
              >
                    Next
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  className="w-full items-center py-4 rounded-2xl flex-row justify-center gap-2"
                  style={presentation.primaryButton}
                  onPress={() => { void continueFromSummary(); }}
                  disabled={sending}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color={presentation.onPrimaryColor} />
                  ) : null}
                  <Text
                className="text-base"
                style={{ color: presentation.onPrimaryColor, fontFamily: headingFont }}
              >
                    {sending ? 'Sending…' : 'Book a time'}
                  </Text>
                </Pressable>
              )}

              {/* Back — goes to previous question, or back to intro on step 0 */}
              <Pressable
                className="items-center py-1"
                onPress={() => {
                  if (stepIndex === 0) {
                    setStarted(false);
                  } else {
                    setStepIndex((current) => Math.max(0, current - 1));
                  }
                  setValidationError(null);
                }}
              >
                <Text
                  className="text-sm"
                  style={{ color: theme.textColor, opacity: 0.55, fontFamily: bodyFont }}
                >
                  ← Back
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
