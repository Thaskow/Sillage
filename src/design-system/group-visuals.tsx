import {
  Anchor,
  Bot,
  Box,
  Briefcase,
  Cloud,
  Code,
  Compass,
  Database,
  FlaskConical,
  Gamepad2,
  Globe,
  Hammer,
  Heart,
  Leaf,
  Rocket,
  Server,
  Shield,
  Sparkles,
  Terminal,
  Waves,
  type LucideIcon,
} from "lucide-react";

export const groupIcons: Record<string, LucideIcon> = {
  briefcase: Briefcase,
  code: Code,
  terminal: Terminal,
  server: Server,
  cloud: Cloud,
  database: Database,
  shield: Shield,
  rocket: Rocket,
  bot: Bot,
  sparkles: Sparkles,
  flask: FlaskConical,
  hammer: Hammer,
  globe: Globe,
  compass: Compass,
  gamepad: Gamepad2,
  waves: Waves,
  anchor: Anchor,
  leaf: Leaf,
  heart: Heart,
  box: Box,
};

export const groupColors = [
  "#2c6b63",
  "#3d6fb0",
  "#6a5bb5",
  "#a45596",
  "#c0563f",
  "#c28a2c",
  "#5e8a3a",
  "#5f6670",
];

export function GroupGlyph({
  icon,
  color,
  size = 22,
}: {
  icon: string;
  color: string;
  size?: number;
}) {
  const Icon = groupIcons[icon] ?? Box;
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[6px]"
      style={{
        width: size,
        height: size,
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 22%, transparent)`,
      }}
    >
      <Icon size={Math.round(size * 0.6)} strokeWidth={1.9} />
    </span>
  );
}
