"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/** One lit pixel of the canvas snapshot, as it travels back to the sender. */
interface VanishParticle {
  x: number;
  y: number;
  /** Remaining radius; shrinks to 0 as the particle reaches the input edge. */
  r: number;
  color: string;
}

export function PlaceholdersAndVanishInput({
  placeholders,
  onChange,
  onSubmit,
}: {
  placeholders: string[];
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const [currentPlaceholder, setCurrentPlaceholder] = useState(0);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* The rotation must not depend on the identity of the placeholders array.
     Callers rebuild that array whenever the underlying rows change, and a fresh
     array re-ran this effect, which cleared the interval and started a new
     3s timer on every render - so the counter never once reached a tick and the
     hint looked frozen. Reading the list through a ref keeps the timer stable
     while still letting it follow genuinely new placeholders. */
  const placeholdersRef = useRef(placeholders);
  placeholdersRef.current = placeholders;

  const startAnimation = () => {
    if (intervalRef.current || placeholdersRef.current.length === 0) return;
    intervalRef.current = setInterval(() => {
      setCurrentPlaceholder((prev) => {
        const total = placeholdersRef.current.length;
        // The list can empty out after the timer started (rows filtered away),
        // and % 0 would poison the index with NaN.
        return total === 0 ? 0 : (prev + 1) % total;
      });
    }, 3000);
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState !== "visible") {
      // Pause the rotation while the tab is hidden; an inactive tab is not
      // burning cycles, and a hidden tab may throttle timers anyway.
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    } else {
      startAnimation();
    }
  };

  useEffect(() => {
    startAnimation();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Only a real change in how many hints there are is worth reacting to, and
  // even then the timer above is left alone; this just keeps the index inside
  // the new bounds so a shorter list cannot blank the hint.
  useEffect(() => {
    setCurrentPlaceholder((prev) =>
      placeholders.length === 0 ? 0 : Math.min(prev, placeholders.length - 1)
    );
  }, [placeholders.length]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const newDataRef = useRef<VanishParticle[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [animating, setAnimating] = useState(false);

  const draw = useCallback(() => {
    if (!inputRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = 800;
    canvas.height = 800;
    ctx.clearRect(0, 0, 800, 800);
    const computedStyles = getComputedStyle(inputRef.current);

    const fontSize = parseFloat(computedStyles.getPropertyValue("font-size"));
    ctx.font = `${fontSize * 2}px ${computedStyles.fontFamily}`;
    ctx.fillStyle = "#FFF";
    ctx.fillText(value, 16, 40);

    const imageData = ctx.getImageData(0, 0, 800, 800);
    const pixelData = imageData.data;
    const newData: { x: number; y: number; color: [number, number, number, number] }[] = [];

    for (let t = 0; t < 800; t++) {
      const i = 4 * t * 800;
      for (let n = 0; n < 800; n++) {
        const e = i + 4 * n;
        if (
          pixelData[e] !== 0 &&
          pixelData[e + 1] !== 0 &&
          pixelData[e + 2] !== 0
        ) {
          newData.push({
            x: n,
            y: t,
            color: [
              pixelData[e],
              pixelData[e + 1],
              pixelData[e + 2],
              pixelData[e + 3],
            ],
          });
        }
      }
    }

    newDataRef.current = newData.map(({ x, y, color }) => ({
      x,
      y,
      r: 1,
      color: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`,
    }));
  }, [value]);

  useEffect(() => {
    draw();
  }, [value, draw]);

  const animate = (start: number) => {
    const animateFrame = (pos: number = 0) => {
      requestAnimationFrame(() => {
        const newArr = [];
        for (let i = 0; i < newDataRef.current.length; i++) {
          const current = newDataRef.current[i];
          if (current.x < pos) {
            newArr.push(current);
          } else {
            if (current.r <= 0) {
              current.r = 0;
              continue;
            }
            current.x += Math.random() > 0.5 ? 1 : -1;
            current.y += Math.random() > 0.5 ? 1 : -1;
            current.r -= 0.05 * Math.random();
            newArr.push(current);
          }
        }
        newDataRef.current = newArr;
        const ctx = canvasRef.current?.getContext("2d");
        if (ctx) {
          ctx.clearRect(pos, 0, 800, 800);
          newDataRef.current.forEach((t) => {
            const { x: n, y: i, r: s, color } = t;
            if (n > pos) {
              ctx.beginPath();
              ctx.rect(n, i, s, s);
              ctx.fillStyle = color;
              ctx.strokeStyle = color;
              ctx.stroke();
            }
          });
        }
        if (newDataRef.current.length > 0) {
          animateFrame(pos - 8);
        } else {
          setValue("");
          setAnimating(false);
        }
      });
    };
    animateFrame(start);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !animating) {
      vanishAndSubmit();
    }
  };

  const vanishAndSubmit = () => {
    const currentValue = inputRef.current?.value || "";
    /* Guard: with nothing typed, animate() never runs, so the setAnimating(false)
       at the end of the particle loop would never fire. Enter on an empty field
       would wedge the input permanently - canvas stuck visible, typed text stuck
       transparent, and onChange blocked because animating never returns false. */
    if (!currentValue) return;

    setAnimating(true);
    draw();

    if (inputRef.current) {
      const maxX = newDataRef.current.reduce(
        (prev, current) => (current.x > prev ? current.x : prev),
        0
      );
      animate(maxX);
    }
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    vanishAndSubmit();
    onSubmit?.(e);
  };

  return (
    <form
      data-filled={value ? "true" : undefined}
      className={cn(
        "w-full relative max-w-xl mx-auto bg-white dark:bg-zinc-800 h-12 rounded-full overflow-hidden shadow-[0px_2px_3px_-1px_rgba(0,0,0,0.1),_0px_1px_0px_0px_rgba(25,28,33,0.02),_0px_0px_0px_1px_rgba(25,28,33,0.08)] transition duration-200",
        value && "bg-gray-50"
      )}
      onSubmit={handleSubmit}
    >
      <canvas
        className={cn(
          "absolute pointer-events-none text-base transform scale-50 top-[20%] left-4 sm:left-10 origin-top-left filter invert dark:invert-0 pr-20",
          !animating ? "opacity-0" : "opacity-100"
        )}
        ref={canvasRef}
      />
      <input
        aria-label="Search ledger records"
        onChange={(e) => {
          if (!animating) {
            setValue(e.target.value);
            onChange?.(e);
          }
        }}
        onKeyDown={handleKeyDown}
        ref={inputRef}
        value={value}
        type="text"
        className={cn(
          "vanish-input w-full relative text-sm sm:text-base z-50 border-none dark:text-white bg-transparent text-black h-full rounded-full focus:outline-none focus:ring-0 pl-6 sm:pl-12 pr-20",
          animating && "text-transparent dark:text-transparent"
        )}
      />

      <button
        disabled={!value}
        type="submit"
        className="absolute right-2 top-1/2 z-50 -translate-y-1/2 h-8 w-8 rounded-full disabled:bg-gray-100 bg-black dark:bg-zinc-900 dark:disabled:bg-zinc-800 transition duration-200 flex items-center justify-center"
      >
        <motion.svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-gray-300 h-4 w-4"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <motion.path
            d="M5 12l14 0"
            initial={{
              strokeDasharray: "50%",
              strokeDashoffset: "50%",
            }}
            animate={{
              strokeDashoffset: value ? 0 : "50%",
            }}
            transition={{
              duration: 0.3,
              ease: "linear",
            }}
          />
          <path d="M13 18l6 -6" />
          <path d="M13 6l6 6" />
        </motion.svg>
      </button>

      <div className="absolute inset-0 flex items-center rounded-full pointer-events-none">
        <AnimatePresence mode="wait">
          {!value && placeholders[currentPlaceholder] && (
            <motion.p
              initial={{
                y: 5,
                opacity: 0,
              }}
              key={`current-placeholder-${currentPlaceholder}`}
              animate={{
                y: 0,
                opacity: 1,
              }}
              exit={{
                y: -15,
                opacity: 0,
              }}
              transition={{
                duration: 0.3,
                ease: "linear",
              }}
              /* Mirrors the input's own pl/pr exactly. The hint is a sibling
                 overlay, so any drift here shows up as the rotating text
                 sitting off to one side of the text you actually type; pr-20
                 also keeps it clear of the submit button. min-w-0 lets the
                 flex item shrink so truncate engages instead of the text
                 sliding under the button. */
              className="vanish-hint dark:text-zinc-500 text-sm sm:text-base font-normal text-neutral-500 pl-6 sm:pl-12 pr-20 text-left truncate min-w-0"
            >
              {placeholders[currentPlaceholder]}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </form>
  );
}
