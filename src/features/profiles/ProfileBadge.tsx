import type { Profile, Provider } from "@/lib/ipc";
import { kindIcon } from "@/features/sessions/visuals";
import { Tooltip } from "@/design-system/primitives";
import { accountLine, initials } from "./store";

export function ProfileBadge({
  profile,
  size = 18,
}: {
  profile: Profile;
  size?: number;
}) {
  return (
    <Tooltip content={`${profile.name} — ${accountLine(profile)}`}>
      <span
        aria-label={`Compte ${profile.name}`}
        style={{
          width: size,
          height: size,
          background: `${profile.color}26`,
          color: profile.color,
          borderColor: `${profile.color}66`,
        }}
        className="inline-flex shrink-0 items-center justify-center rounded-[5px] border text-[9.5px] leading-none font-semibold"
      >
        {initials(profile.name)}
      </span>
    </Tooltip>
  );
}

export function AccountAvatar({
  provider,
  profile,
  size = 28,
}: {
  provider: Provider;
  profile?: Profile | null;
  size?: number;
}) {
  const Icon = kindIcon[provider];
  const tile = (
    <span
      aria-label={profile ? `Compte ${profile.name}` : undefined}
      style={{ width: size, height: size }}
      className="relative inline-flex shrink-0 items-center justify-center rounded-md border border-line bg-raised text-fg"
    >
      <Icon size={Math.round(size * 0.52)} />
      {profile && (
        <span
          aria-hidden="true"
          style={{
            color: profile.color,
            borderColor: `${profile.color}80`,
            backgroundImage: `linear-gradient(${profile.color}33, ${profile.color}33)`,
          }}
          className="absolute -right-1.5 -bottom-1.5 inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-[4px] border bg-raised px-[2px] text-[8px] leading-none font-bold"
        >
          {initials(profile.name)}
        </span>
      )}
    </span>
  );
  return profile ? (
    <Tooltip content={`${profile.name} — ${accountLine(profile)}`}>
      {tile}
    </Tooltip>
  ) : (
    tile
  );
}

export function DefaultAccountBadge({ size = 18 }: { size?: number }) {
  return (
    <Tooltip content="Compte habituel de Windows (dossier .claude par défaut)">
      <span
        aria-label="Compte habituel"
        style={{ width: size, height: size }}
        className="inline-flex shrink-0 items-center justify-center rounded-[5px] border border-line-strong text-[9.5px] leading-none font-semibold text-fg-3"
      >
        ·
      </span>
    </Tooltip>
  );
}
