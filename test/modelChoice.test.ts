import { describe, it, expect, beforeEach } from 'vitest';
import { createAnsweredBy, createModelPicker, offeredModels, pickedModelId } from '../src/modelChoice';
import type { OfferedModel, WidgetSettings } from '../src/types';

const MODELS: OfferedModel[] = [
  { id: 1, name: 'DeepSeek V4.1 Flash', logo: null, is_default: true },
  { id: 2, name: 'GPT-6 Sol', logo: 'https://chat.example/model-logos/labs/openai.svg', is_default: false }
];

function host(models: OfferedModel[] | undefined, agentId = 'agent-models') {
  return { agentId, settings: { models } as WidgetSettings };
}

// The visitor picks the model of each message when the agent offers a few;
// the pick is remembered per agent and sent as the stream's model_id.
describe('model choice', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
  });

  it('offers no choice with fewer than two models', () => {
    expect(offeredModels(host(undefined))).toEqual([]);
    expect(offeredModels(host([MODELS[0]]))).toEqual([]);
    expect(pickedModelId(host([MODELS[0]]))).toBeNull();
    expect(createModelPicker(host([MODELS[0]]))).toBeNull();
  });

  it('starts on the agent\'s own model', () => {
    expect(pickedModelId(host(MODELS))).toBe(1);
  });

  it('remembers a pick from the menu', () => {
    const picker = createModelPicker(host(MODELS))!;
    document.body.appendChild(picker);

    picker.querySelector<HTMLButtonElement>('.chatvia-widget-model-btn')!.click();
    const items = picker.querySelectorAll<HTMLButtonElement>('.chatvia-widget-model-item');
    expect(items).toHaveLength(2);
    expect(items[0].getAttribute('aria-checked')).toBe('true');

    items[1].click();

    expect(pickedModelId(host(MODELS))).toBe(2);
    expect(picker.querySelector('.chatvia-widget-model-menu')!.hasAttribute('hidden')).toBe(true);
    expect(picker.querySelector('.chatvia-widget-model-btn')!.textContent).toContain('GPT-6 Sol');
  });

  it('falls back to the agent\'s model when the pick is no longer offered', () => {
    localStorage.setItem('agent-models-model-choice', '99');

    expect(pickedModelId(host(MODELS))).toBe(1);
  });

  it('keeps picks apart per agent', () => {
    localStorage.setItem('agent-a-model-choice', '2');

    expect(pickedModelId(host(MODELS, 'agent-a'))).toBe(2);
    expect(pickedModelId(host(MODELS, 'agent-b'))).toBe(1);
  });
});

describe('answered by', () => {
  it('shows the model that wrote a reply while the agent offers a choice', () => {
    const badge = createAnsweredBy(host(MODELS), 2);

    expect(badge?.textContent).toBe('');
    expect(badge?.title).toContain('GPT-6 Sol');
    expect(badge?.getAttribute('aria-label')).toContain('GPT-6 Sol');
  });

  it('shows nothing without a choice, or for a model no longer offered', () => {
    expect(createAnsweredBy(host([MODELS[0]]), 1)).toBeNull();
    expect(createAnsweredBy(host(MODELS), 99)).toBeNull();
    expect(createAnsweredBy(host(MODELS), null)).toBeNull();
  });
});
