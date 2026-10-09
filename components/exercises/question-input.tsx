"use client";

import { Button, OutputBlock } from "@/components/ui";
import { BIG_O_CLASSES, BLANK, type PublicQuestion } from "@/lib/exercises/schema";

/**
 * One accessible input per question type (spec §43): radio and checkbox groups with legends,
 * a labelled text area, labelled blanks, and an ordering list moved with buttons (no drag
 * required). `value` is the response shape the server's grader expects.
 */

export type ResponseValue = Record<string, unknown> | undefined;

interface Props {
  readonly question: PublicQuestion;
  readonly value: ResponseValue;
  readonly onChange: (value: ResponseValue) => void;
  readonly disabled: boolean;
}

function Choices({ name, options, multiple, selected, onSelect, disabled, legend }: {
  name: string;
  options: readonly string[];
  multiple: boolean;
  selected: readonly number[];
  onSelect: (selected: number[]) => void;
  disabled: boolean;
  legend: string;
}) {
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-1">
      <legend className="sr-only">{legend}</legend>
      {options.map((option, index) => (
        <label key={option} className="flex items-start gap-2 rounded px-1 py-0.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60">
          <input
            type={multiple ? "checkbox" : "radio"}
            name={name}
            checked={selected.includes(index)}
            onChange={() => onSelect(multiple ? (selected.includes(index) ? selected.filter((item) => item !== index) : [...selected, index]) : [index])}
            className="mt-1"
          />
          <span>{option}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Initial response for a question; undefined means "not answered yet". */
export function initialValue(question: PublicQuestion): ResponseValue {
  if (question.type === "order") return { order: question.steps.map((_, index) => index) };
  if (question.type === "fill_blank") return { blanks: Array.from({ length: question.code.split(BLANK).length - 1 }, () => "") };
  return undefined;
}

export function isComplete(question: PublicQuestion, value: ResponseValue): boolean {
  if (value === undefined) return false;
  switch (question.type) {
    case "multi_choice":
      return (value.choices as number[]).length > 0;
    case "predict_output":
      return (value.text as string).trim() !== "";
    case "fill_blank":
      return (value.blanks as string[]).every((blank) => blank.trim() !== "");
    default:
      return true;
  }
}

export function QuestionInput({ question, value, onChange, disabled }: Props) {
  const name = `question-${question.id}`;
  switch (question.type) {
    case "single_choice":
    case "pattern":
      return <Choices name={name} legend={question.prompt} options={question.options} multiple={false} disabled={disabled} selected={value ? [value.choice as number] : []} onSelect={([choice]) => onChange({ choice })} />;
    case "multi_choice":
      return <Choices name={name} legend={question.prompt} options={question.options} multiple disabled={disabled} selected={(value?.choices as number[]) ?? []} onSelect={(choices) => onChange({ choices })} />;
    case "true_false":
      return <Choices name={name} legend={question.prompt} options={["True", "False"]} multiple={false} disabled={disabled} selected={value ? [value.value ? 0 : 1] : []} onSelect={([choice]) => onChange({ value: choice === 0 })} />;
    case "big_o": {
      const options: readonly string[] = question.options ?? BIG_O_CLASSES;
      return (
        <Choices
          name={name}
          legend={`${question.ask === "time" ? "Time" : "Space"} complexity`}
          options={options}
          multiple={false}
          disabled={disabled}
          selected={value ? [options.indexOf(value.choice as string)] : []}
          onSelect={([index]) => onChange({ choice: options[index] })}
        />
      );
    }
    case "predict_output":
      return (
        <div>
          <label htmlFor={name} className="text-sm font-medium">
            Exact output
          </label>
          <textarea
            id={name}
            rows={3}
            disabled={disabled}
            value={(value?.text as string) ?? ""}
            onChange={(event) => onChange({ text: event.target.value })}
            spellCheck={false}
            className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent p-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
          />
        </div>
      );
    case "fill_blank": {
      const blanks = (value?.blanks as string[]) ?? [];
      return (
        <div className="flex flex-col gap-2">
          {blanks.map((blank, index) => (
            <div key={index} className="flex items-center gap-2">
              <label htmlFor={`${name}-${index}`} className="text-sm font-medium">
                Blank {index + 1}
              </label>
              <input
                id={`${name}-${index}`}
                value={blank}
                disabled={disabled}
                spellCheck={false}
                onChange={(event) => onChange({ blanks: blanks.map((current, position) => (position === index ? event.target.value : current)) })}
                className="rounded-md border border-neutral-300 bg-transparent px-2 py-1 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-neutral-700"
              />
            </div>
          ))}
        </div>
      );
    }
    case "order": {
      const order = (value?.order as number[]) ?? [];
      const move = (position: number, by: number) => {
        const next = [...order];
        [next[position], next[position + by]] = [next[position + by], next[position]];
        onChange({ order: next });
      };
      return (
        <ol className="flex flex-col gap-1" aria-label="Steps, in your order">
          {order.map((stepIndex, position) => (
            <li key={stepIndex} className="flex items-center gap-2 rounded-md border border-neutral-200 px-2 py-1 dark:border-neutral-800">
              <span className="w-5 text-sm text-neutral-500 dark:text-neutral-400">{position + 1}.</span>
              <span className="flex-1">{question.steps[stepIndex]}</span>
              <Button variant="ghost" disabled={disabled || position === 0} onClick={() => move(position, -1)} aria-label={`Move "${question.steps[stepIndex]}" up`}>
                ↑
              </Button>
              <Button variant="ghost" disabled={disabled || position === order.length - 1} onClick={() => move(position, 1)} aria-label={`Move "${question.steps[stepIndex]}" down`}>
                ↓
              </Button>
            </li>
          ))}
        </ol>
      );
    }
  }
}

/** Code shown with a question (fill_blank shows its blanks as ____). */
export function QuestionCode({ code }: { code: string }) {
  return <OutputBlock label="Code">{code}</OutputBlock>;
}
