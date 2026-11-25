/**
 * 「对话与模型」卡：对话模型、历史轮数与动作联动。
 * 都与全局开关同语义：只改本地状态，随「保存」整包写入；宿主生成时优先用模型，失败自动回落。
 * 候选清单拉取失败只在这里提示一行，不阻塞已有配置值的显示与保存。
 * @module dsh-pet/src/client/settings/model-card
 */
import type { FunctionComponent } from 'react';
import type { ModelSelection } from '../../shared/types.ts';
import type { ModelCatalogGroup } from './picker/index.ts';
import type { ModelPickerProps } from './picker/index.ts';
import type { SettingsRuntime } from './runtime.ts';
import { makeUiKit, numberInputProps } from './ui.ts';

/** 两个模型字段的键名。 */
export type ModelFieldKey = 'whisperModel' | 'chatModel';

/** 三个对话开关的键名，与成品配置的字段名一致。 */
export type ChatFlagKey = 'whisperImageEnabled' | 'chatImageEnabled' | 'chatAnimationEnabled';

/** 三个对话开关的当前值。 */
export type ChatFlagValues = Record<ChatFlagKey, boolean>;

/** 模型卡的输入。 */
export interface ModelCardProps {
  /** 保存中或配置未就绪时禁用全部控件。 */
  busy: boolean;
  /** 候选清单；`null` 表示还在拉取。 */
  catalog: readonly ModelCatalogGroup[] | null;
  /** 候选清单拉取失败。 */
  failed: boolean;
  /** 对话用的模型。 */
  chatModel: ModelSelection;
  /** 某个模型字段被改。 */
  onModelChange: (key: ModelFieldKey, value: ModelSelection) => void;
  /** 对话历史条数。 */
  chatMemory: number;
  /** 改对话历史条数。 */
  onChatMemoryChange: (value: number) => void;
  /** 对话动作联动开关。 */
  values: Pick<ChatFlagValues, 'chatAnimationEnabled'>;
  /** 某个对话开关被切换。 */
  onFlagChange: (key: ChatFlagKey, value: boolean) => void;
}

/**
 * 造模型卡。
 *
 * @param rt - 注入的 react 能力与翻译函数。
 * @param picker - 模型选择器组件（由外壳用同一份运行时造好，跨渲染稳定）。
 * @returns 卡片组件。
 */
export function makeModelCard(
  rt: SettingsRuntime,
  picker: FunctionComponent<ModelPickerProps>,
): FunctionComponent<ModelCardProps> {
  const { h, t } = rt;
  const { cardHead, field, toggleCell } = makeUiKit({ h, t });

  return function ModelCard(props: ModelCardProps) {
    const { busy, catalog, failed } = props;

    const modelLabel = t('chatModelLabel');

    return h('div', {
      className: 'dsh-pet-cfg__card',
      children: [
        cardHead(t('modelTitle')),
        failed
          ? h('p', {
              className: 'dsh-pet-cfg__note',
              style: { color: 'var(--dsw-alias-state-error-primary)' },
              children: t('modelCatalogFailed'),
            })
          : null,
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: [
            field(
              modelLabel,
              h(picker, {
                label: modelLabel,
                value: props.chatModel,
                disabled: busy,
                catalog,
                failed,
                onChange: (next: ModelSelection) => props.onModelChange('chatModel', next),
              }),
              t('modelFieldHint'),
            ),
            field(
              t('chatMemory'),
              h(
                'input',
                numberInputProps(props.chatMemory, props.onChatMemoryChange, { step: '1', min: '0', disabled: busy }),
              ),
              t('chatMemoryHint'),
            ),
          ],
        }),
        h('div', {
          className: 'dsh-pet-cfg__grid2',
          children: toggleCell('chatAnimationToggle', props.values.chatAnimationEnabled, busy, (value) =>
            props.onFlagChange('chatAnimationEnabled', value),
          ),
        }),
      ],
    });
  };
}
