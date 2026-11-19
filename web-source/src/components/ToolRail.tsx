import { Fragment } from 'react';
import { t, type StringKey } from '../i18n';
import type { Tool } from '../types';
import type { IconName } from './Icon';
import { Divider, IconButton, Panel } from './ui';

interface ToolInfo {
  tool: Tool;
  label: StringKey;
  key: string;
  icon: IconName;
}

export const TOOL_GROUPS: ToolInfo[][] = [
  [{ tool: 'select', label: 'tool_select', key: 'V', icon: 'select' }],
  [
    { tool: 'pen', label: 'tool_pen', key: 'P', icon: 'pen' },
    { tool: 'highlighter', label: 'tool_highlighter', key: 'H', icon: 'highlighter' },
    { tool: 'eraser', label: 'tool_eraser', key: 'E', icon: 'eraser' },
  ],
  [
    { tool: 'line', label: 'tool_line', key: 'L', icon: 'line' },
    { tool: 'arrow', label: 'tool_arrow', key: 'A', icon: 'arrow' },
    { tool: 'rect', label: 'tool_rect', key: 'R', icon: 'rect' },
    { tool: 'ellipse', label: 'tool_ellipse', key: 'O', icon: 'ellipse' },
  ],
  [
    { tool: 'text', label: 'tool_text', key: 'T', icon: 'text' },
    { tool: 'image', label: 'tool_image', key: 'I', icon: 'image' },
  ],
];

interface ToolRailProps {
  tool: Tool;
  imagesEnabled: boolean;
  onSelect: (tool: Tool) => void;
}

export function ToolRail({ tool, imagesEnabled, onSelect }: ToolRailProps) {
  return (
    <Panel className="flex flex-col items-center gap-1 self-center p-1.5">
      {TOOL_GROUPS.map((group, index) => (
        <Fragment key={group[0].tool}>
          {index > 0 && <Divider />}
          {group
            .filter((info) => info.tool !== 'image' || imagesEnabled)
            .map((info) => (
              <IconButton
                key={info.tool}
                icon={info.icon}
                label={t(info.label)}
                hint={info.key}
                tooltip="right"
                active={tool === info.tool}
                onClick={() => onSelect(info.tool)}
              />
            ))}
        </Fragment>
      ))}
    </Panel>
  );
}
