import type { Lang, NotifyKey } from './types';

// WhatsApp utility templates. In production each one is submitted to Meta for
// approval per school; {placeholders} map to template variables.
export const TEMPLATES: Record<NotifyKey, Record<Lang, string>> = {
  arrived: {
    en: '{student} reached school at {time} today. – {school}',
    ta: '{student} இன்று {time} மணிக்கு பள்ளிக்கு வந்துவிட்டார். – {school}',
  },
  absent: {
    en: '{student} is marked absent today ({date}). Please reply with the reason for leave. – {school}',
    ta: '{student} இன்று ({date}) பள்ளிக்கு வரவில்லை. விடுப்புக்கான காரணத்தை பதில் அனுப்பவும். – {school}',
  },
  late: {
    en: '{student} reached school late today, at {time}. – {school}',
    ta: '{student} இன்று {time} மணிக்கு தாமதமாக பள்ளிக்கு வந்தார். – {school}',
  },
  homework: {
    en: "Today's {subject} homework for {student}: {title}. Due {due}. – {school}",
    ta: '{student} – இன்றைய {subject} வீட்டுப்பாடம்: {title}. சமர்ப்பிக்க வேண்டிய நாள் {due}. – {school}',
  },
  marks: {
    en: '{student} scored {marks}/{max} in {exam} ({subject}). Answer-wise feedback is on the parent page. – {school}',
    ta: '{student} {exam} ({subject}) தேர்வில் {marks}/{max} மதிப்பெண்கள் பெற்றுள்ளார். விரிவான கருத்துகள் பெற்றோர் பக்கத்தில் உள்ளன. – {school}',
  },
  report: {
    en: "{student}'s report card for {exam} is ready: {marks}% overall, grade {grade}. – {school}",
    ta: '{student} அவர்களின் {exam} மதிப்பெண் அட்டை தயார்: மொத்தம் {marks}%, தரம் {grade}. – {school}',
  },
};

export const TEMPLATE_LABELS: Record<NotifyKey, string> = {
  arrived: 'Arrived at school',
  absent: 'Absent today',
  late: 'Late arrival',
  homework: 'Homework',
  marks: 'Test marks',
  report: 'Report card',
};

export function render(key: NotifyKey, lang: Lang, vars: Record<string, string | number>): string {
  return TEMPLATES[key][lang].replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
