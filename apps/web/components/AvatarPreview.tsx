"use client";
import { useEffect, useRef, useState } from "react";
import type { AvatarConfig, Facing } from "@third-space/contracts";
import {
  ACCESSORY_IDS,
  HAIR_IDS,
  OUTFIT_IDS,
  SKIN_COLORS,
  HAIR_COLORS,
  CLOTHING_COLORS,
  TROUSER_COLORS,
} from "@third-space/config";
import { drawAvatarCanvas } from "../lib/pixel-art";

export function AvatarPreview({
  avatar,
  name,
}: {
  avatar: AvatarConfig;
  name: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [facing, setFacing] = useState<Facing>("down");
  useEffect(() => {
    if (canvas.current) drawAvatarCanvas(canvas.current, avatar, facing, 0);
  }, [avatar, facing]);
  return (
    <div className="character-preview">
      <div className="character-stage">
        <span className="character-stage-star" aria-hidden="true">
          ✦
        </span>
        <canvas
          ref={canvas}
          width={24}
          height={32}
          aria-label={`Your character: ${avatar.outfit}, ${avatar.hair} hair, ${avatar.accessory}`}
          role="img"
        />
        <span className="character-shadow" aria-hidden="true" />
      </div>
      <div className="character-caption">
        <strong>{name.trim() || "A new friend"}</strong>
        <span>Your very own little character</span>
      </div>
      <div
        className="character-rotation"
        role="group"
        aria-label="Preview direction"
      >
        {(
          [
            ["down", "Front"],
            ["left", "Left"],
            ["up", "Back"],
            ["right", "Right"],
          ] as [Facing, string][]
        ).map(([direction, label]) => (
          <button
            key={direction}
            type="button"
            aria-pressed={facing === direction}
            onClick={() => setFacing(direction)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

type ColorKey = "skinColor" | "hairColor" | "clothingColor" | "trouserColor";
const palettes: {
  key: ColorKey;
  label: string;
  colors: readonly string[];
}[] = [
  { key: "skinColor", label: "Skin color", colors: SKIN_COLORS },
  { key: "hairColor", label: "Hair color", colors: HAIR_COLORS },
  { key: "clothingColor", label: "Shirt color", colors: CLOTHING_COLORS },
  { key: "trouserColor", label: "Trouser color", colors: TROUSER_COLORS },
];

function ColorPicker({
  label,
  value,
  colors,
  onChange,
}: {
  label: string;
  value: string;
  colors: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="character-colors">
      <legend>{label}</legend>
      <div className="character-swatches">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={`${label} ${color}`}
            aria-pressed={value === color}
            className={value === color ? "selected" : ""}
            style={{ background: color }}
            onClick={() => onChange(color)}
          />
        ))}
        <label className="custom-color">
          <span>Custom</span>
          <input
            aria-label={`${label} custom`}
            type="color"
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        </label>
      </div>
    </fieldset>
  );
}

export function AvatarCustomizer({
  avatar,
  name,
  onChange,
}: {
  avatar: AvatarConfig;
  name: string;
  onChange: (avatar: AvatarConfig) => void;
}) {
  return (
    <div className="avatar-customizer character-customizer">
      <div className="character-heading">
        <span className="eyebrow">MAKE YOURSELF AT HOME</span>
        <span>Original pixel characters</span>
      </div>
      <AvatarPreview avatar={avatar} name={name} />
      <div className="avatar-options">
        <label>
          Hair
          <select
            aria-label="Hair"
            value={avatar.hair}
            onChange={(event) =>
              onChange({
                ...avatar,
                hair: event.target.value as AvatarConfig["hair"],
              })
            }
          >
            {HAIR_IDS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Outfit
          <select
            aria-label="Outfit"
            value={avatar.outfit}
            onChange={(event) =>
              onChange({
                ...avatar,
                outfit: event.target.value as AvatarConfig["outfit"],
              })
            }
          >
            {OUTFIT_IDS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Extra
          <select
            aria-label="Extra"
            value={avatar.accessory}
            onChange={(event) =>
              onChange({
                ...avatar,
                accessory: event.target.value as AvatarConfig["accessory"],
              })
            }
          >
            {ACCESSORY_IDS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="character-palette-grid">
        {palettes.map(({ key, label, colors }) => (
          <ColorPicker
            key={key}
            label={label}
            value={avatar[key]}
            colors={colors}
            onChange={(color) =>
              onChange({
                ...avatar,
                [key]: color,
                ...(key === "skinColor" ? { color } : {}),
              })
            }
          />
        ))}
      </div>
      <p className="character-preview-note">
        Your look travels with you into every room and race.
      </p>
    </div>
  );
}
