import type { OnlineQuestion } from './types';

/** Sample MCQ banks for online tests and practice. A school's own bank can replace these later. */
export const TRIG: OnlineQuestion[] = [
  { q: 'sin²θ + cos²θ equals', options: ['0', '1', 'tan θ', '2'], answer: 1, why: 'This is the basic Pythagorean identity.', chapter: 'Trigonometry' },
  { q: 'If tan θ = 1, then θ is', options: ['30°', '45°', '60°', '90°'], answer: 1, why: 'tan 45° = 1, because sin 45° = cos 45°.', chapter: 'Trigonometry' },
  { q: 'The angle of elevation of the sun is 45°. A 10 m pole casts a shadow of', options: ['5 m', '10 m', '10√3 m', '20 m'], answer: 1, why: 'tan 45° = height ÷ shadow = 1, so the shadow equals the height.', chapter: 'Trigonometry' },
  { q: '(1 + tan²θ) equals', options: ['sec²θ', 'cosec²θ', 'cot²θ', '1'], answer: 0, why: 'Divide sin²θ + cos²θ = 1 by cos²θ.', chapter: 'Trigonometry' },
  { q: 'cos 60° is', options: ['√3/2', '1/2', '1', '0'], answer: 1, why: 'cos 60° = 1/2. Learn the 0°, 30°, 45°, 60°, 90° table.', chapter: 'Trigonometry' },
];
export const MENSURATION: OnlineQuestion[] = [
  { q: 'Curved surface area of a cylinder is', options: ['πr²h', '2πrh', '2πr(h + r)', '⅓πr²h'], answer: 1, why: 'CSA = 2πrh. Total adds the two circles: 2πr(h + r).', chapter: 'Mensuration' },
  { q: 'Volume of a cone is', options: ['πr²h', '⅓πr²h', '4/3 πr³', '2πrh'], answer: 1, why: 'A cone holds one third of the cylinder with the same base and height.', chapter: 'Mensuration' },
  { q: 'A sphere of radius 3 cm has volume', options: ['36π cm³', '27π cm³', '12π cm³', '9π cm³'], answer: 0, why: '4/3 × π × 27 = 36π cm³.', chapter: 'Mensuration' },
  { q: 'Slant height of a cone with r = 6, h = 8 is', options: ['10', '12', '14', '7'], answer: 0, why: 'l = √(r² + h²) = √100 = 10.', chapter: 'Mensuration' },
];
export const ALGEBRA: OnlineQuestion[] = [
  { q: 'The roots of x² − 5x + 6 = 0 are', options: ['2 and 3', '−2 and −3', '1 and 6', '−1 and 6'], answer: 0, why: 'x² − 5x + 6 = (x − 2)(x − 3).', chapter: 'Algebra' },
  { q: 'The discriminant of ax² + bx + c = 0 is', options: ['b² + 4ac', 'b² − 4ac', '4ac − b²', '√(b² − 4ac)'], answer: 1, why: 'Δ = b² − 4ac decides the nature of the roots.', chapter: 'Algebra' },
  { q: 'If Δ < 0, the roots are', options: ['Real and equal', 'Real and distinct', 'Not real', 'Zero'], answer: 2, why: 'A negative discriminant has no real square root.', chapter: 'Algebra' },
  { q: 'The 10th term of 3, 7, 11, … is', options: ['39', '40', '43', '36'], answer: 0, why: 'a + 9d = 3 + 36 = 39.', chapter: 'Algebra' },
  { q: 'Sum of roots of 2x² − 8x + 3 = 0 is', options: ['4', '−4', '3/2', '8'], answer: 0, why: 'Sum = −b/a = 8/2 = 4.', chapter: 'Algebra' },
];
export const SCIENCE: OnlineQuestion[] = [
  { q: 'The SI unit of electric current is', options: ['Volt', 'Ohm', 'Ampere', 'Watt'], answer: 2, why: 'Current is measured in amperes (A).', chapter: 'Electricity' },
  { q: 'Ohm’s law is', options: ['V = IR', 'P = VI', 'V = I/R', 'R = VI'], answer: 0, why: 'At constant temperature, voltage = current × resistance.', chapter: 'Electricity' },
  { q: 'A concave lens always forms an image that is', options: ['Real and inverted', 'Virtual and diminished', 'Real and enlarged', 'Virtual and enlarged'], answer: 1, why: 'A concave lens diverges light, so the image is virtual, erect and smaller.', chapter: 'Optics' },
  { q: 'The power of a lens of focal length 0.5 m is', options: ['0.5 D', '1 D', '2 D', '5 D'], answer: 2, why: 'P = 1/f = 1/0.5 = 2 dioptres.', chapter: 'Optics' },
  { q: 'Resistors of 2 Ω and 3 Ω in series give', options: ['1.2 Ω', '5 Ω', '6 Ω', '1 Ω'], answer: 1, why: 'In series, resistances add: 2 + 3 = 5 Ω.', chapter: 'Electricity' },
];
export const GENERAL: OnlineQuestion[] = [
  { q: 'Plants make their food by', options: ['Respiration', 'Photosynthesis', 'Digestion', 'Transpiration'], answer: 1, why: 'Green leaves use sunlight, water and carbon dioxide to make food.', chapter: 'General' },
  { q: '3/4 + 1/4 equals', options: ['1', '4/8', '3/16', '1/2'], answer: 0, why: 'Same denominator, so add the numerators: 4/4 = 1.', chapter: 'General' },
  { q: 'The capital of Tamil Nadu is', options: ['Madurai', 'Coimbatore', 'Chennai', 'Tiruchirappalli'], answer: 2, why: 'Chennai is the capital of Tamil Nadu.', chapter: 'General' },
  { q: 'Water boils at (at sea level)', options: ['50 °C', '90 °C', '100 °C', '120 °C'], answer: 2, why: 'Pure water boils at 100 °C at normal air pressure.', chapter: 'General' },
];

/** Questions for an online test: the bank that matches its name, else its subject, up to `count`. */
export function pickQuestions(name: string, subject: string, count: number): OnlineQuestion[] {
  const n = name.toLowerCase();
  const pool = /trig/.test(n) ? TRIG
    : /mensur|cone|cylinder|sphere|volume/.test(n) ? MENSURATION
    : /algebra|quadratic|equation|progression|\bap\b/.test(n) ? ALGEBRA
    : /optic|lens|electric|current|light|ohm/.test(n) ? SCIENCE
    : subject === 'Maths' ? [...TRIG, ...MENSURATION, ...ALGEBRA]
    : ['Science', 'Physics'].includes(subject) ? SCIENCE
    : GENERAL;
  return pool.slice(0, Math.max(1, Math.min(count, pool.length))).map((q) => ({ ...q, options: [...q.options] }));
}
