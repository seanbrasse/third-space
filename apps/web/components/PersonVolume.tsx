import { clampVolume } from "../lib/person-volume";
export default function PersonVolume({
  name,
  value,
  muted,
  onChange,
  onMute,
}: {
  name: string;
  value: number;
  muted: boolean;
  onChange: (value: number) => void;
  onMute: () => void;
}) {
  const volume = clampVolume(value);
  return (
    <div className="person-volume">
      <label>
        <span>
          Soundboard <output>{Math.round(volume * 100)}%</output>
        </span>
        <input
          aria-label={`Soundboard volume for ${name}`}
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
      <button className="secondary" aria-pressed={muted} onClick={onMute}>
        {muted ? "Unmute sounds" : "Mute sounds"}
      </button>
      {muted && <small>Sounds muted; your volume setting is saved.</small>}
    </div>
  );
}
