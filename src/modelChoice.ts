/**
 * Model choice: the model the visitor's next message is answered with, from
 * the ones the agent offers (`settings.models`, the agent's own first; fewer
 * than two means no picker). The pick is remembered per agent and sent with
 * each message as `model_id`; one the agent no longer offers falls back to
 * its own model, on the server and here.
 */

import { t } from './i18n';
import { PersistenceManager } from './persistence';
import { createElement, createIcon } from './ui';
import type { OfferedModel, WidgetSettings } from './types';

const STORAGE_NAME = 'model-choice';

/** Where a picker lives: the agent it belongs to and that agent's settings. */
interface ModelChoiceHost {
  agentId: string;
  settings: WidgetSettings;
}

/** The models the visitor may pick from; empty when there is no choice. */
export function offeredModels(host: ModelChoiceHost): OfferedModel[] {
  const models = Array.isArray(host.settings?.models) ? host.settings.models : [];
  return models.length > 1 ? models : [];
}

/** The id to send as `model_id`; null while the agent offers no choice. */
export function pickedModelId(host: ModelChoiceHost): number | null {
  return pickedModel(host)?.id ?? null;
}

function pickedModel(host: ModelChoiceHost): OfferedModel | null {
  const models = offeredModels(host);
  if (models.length === 0) return null;

  const stored = Number(new PersistenceManager(host.agentId).get(STORAGE_NAME));
  return (
    models.find(model => model.id === stored) ?? models.find(model => model.is_default) ?? models[0]
  );
}

function pick(host: ModelChoiceHost, id: number): void {
  new PersistenceManager(host.agentId).set(STORAGE_NAME, String(id));
}

/**
 * A model maker's logo: a one-colour SVG drawn as a mask the text colour
 * fills, so it reads in light and dark themes. Nothing when it has none.
 */
function logo(model: OfferedModel): HTMLSpanElement {
  const mark = createElement('span', {
    className: 'chatvia-widget-model-logo',
    'aria-hidden': 'true'
  });
  if (model.logo) {
    const url = `url("${model.logo.replace(/"/g, '%22')}")`;
    mark.style.setProperty('mask-image', url);
    mark.style.setProperty('-webkit-mask-image', url);
  } else {
    mark.classList.add('chatvia-widget-model-logo--none');
  }
  return mark;
}

/**
 * The picker: a compact button (logo, name, chevron) that opens a menu of the
 * offered models above it. Null while the agent offers no choice. Every
 * picker on the page reads the same remembered pick, so the bar and the
 * chat window stay in step.
 */
export function createModelPicker(host: ModelChoiceHost, extraClass = ''): HTMLDivElement | null {
  const models = offeredModels(host);
  if (models.length === 0) return null;

  const root = createElement('div', {
    className: `chatvia-widget-model-picker ${extraClass}`.trim()
  });
  const button = createElement('button', {
    type: 'button',
    className: 'chatvia-widget-model-btn',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false'
  });
  const menu = createElement('div', {
    className: 'chatvia-widget-model-menu',
    role: 'menu',
    'aria-label': t('model.title')
  });
  menu.hidden = true;

  const renderButton = (): void => {
    const current = pickedModel(host);
    button.replaceChildren();
    if (!current) return;
    button.setAttribute('aria-label', t('model.picker', { model: current.name }));
    button.title = current.name;
    button.appendChild(logo(current));
    button.appendChild(
      createElement('span', { className: 'chatvia-widget-model-name', textContent: current.name })
    );
    button.appendChild(createIcon('chevron-down'));
  };

  const renderMenu = (): void => {
    const current = pickedModel(host);
    menu.replaceChildren(
      createElement('div', {
        className: 'chatvia-widget-model-menu-title',
        textContent: t('model.title')
      })
    );
    for (const model of models) {
      const item = createElement('button', {
        type: 'button',
        role: 'menuitemradio',
        className: 'chatvia-widget-model-item',
        'aria-checked': String(model.id === current?.id)
      });
      item.appendChild(logo(model));
      item.appendChild(
        createElement('span', { className: 'chatvia-widget-model-name', textContent: model.name })
      );
      if (model.is_default) {
        item.appendChild(
          createElement('span', {
            className: 'chatvia-widget-model-default',
            textContent: t('model.default')
          })
        );
      }
      item.addEventListener('click', () => {
        pick(host, model.id);
        close();
        renderButton();
        button.focus();
      });
      menu.appendChild(item);
    }
  };

  const onOutside = (event: Event): void => {
    if (!root.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      close();
      button.focus();
    }
  };

  function open(): void {
    renderMenu();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    (menu.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
  }

  function close(): void {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }

  button.addEventListener('click', () => (menu.hidden ? open() : close()));
  // Opening the menu (or the picker taking focus) must not open the chat or
  // send the bar's text.
  root.addEventListener('click', event => event.stopPropagation());

  // Another picker on the page (bar ↔ chat window) changed the pick.
  root.addEventListener('focusin', renderButton);

  renderButton();
  root.appendChild(button);
  root.appendChild(menu);
  return root;
}

/**
 * The logo of the model that wrote a reply, for its action row; its name
 * shows as the tooltip. Null unless the agent offers a choice of models and
 * still offers that one.
 */
export function createAnsweredBy(
  host: ModelChoiceHost,
  llmId: number | null | undefined
): HTMLSpanElement | null {
  const model = offeredModels(host).find(offered => offered.id === llmId);
  if (!model) return null;

  const label = t('model.answered_by', { model: model.name });
  const badge = createElement('span', {
    className: 'chatvia-widget-answered-by',
    title: label,
    role: 'img',
    'aria-label': label
  });
  badge.appendChild(logo(model));
  return badge;
}
