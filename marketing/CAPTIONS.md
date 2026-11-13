# Basic ECG Interpretation — social media kit

Images are in this folder. Replace **[LINK]** with your course website address.
On Instagram and TikTok, put the link in your bio and say "link in bio".

| File | Use it for |
| --- | --- |
| `1-launch-1080x1080.png` | Launch announcement: Instagram, Facebook and LinkedIn feed |
| `2-name-that-rhythm-1080x1080.png` | Engagement post (rhythm quiz) |
| `3-whats-inside-1080x1080.png` | Features and "try it free" post |
| `4-story-1080x1920.png` | Instagram and Facebook Stories, TikTok, Reels cover |
| `5-facebook-linkedin-1200x630.png` | Facebook and LinkedIn link posts, X/Twitter, event or page banner |

**Instagram feed:** use the portrait versions in `instagram-portrait/` (1080×1350). Instagram's profile grid now shows posts taller than square, so these fill it best. The square versions are for Facebook and LinkedIn.

**Profile and page setup:** see `brand/`:

| File | Use it for |
| --- | --- |
| `brand/profile-picture-1080x1080.png` | Profile picture for the Facebook Page and Instagram (it's shown as a circle) |
| `brand/facebook-cover-1640x624.png` | Facebook Page cover for the company as a whole: CSHealthED, healthcare education and consulting (healthcare, EMS, consulting, fire service). The text sits in the middle, so it isn't cut off on phones. |
| `brand/facebook-cover-ecg-course-1640x624.png` | Alternative cover for promoting the ECG course, e.g. during launch week |
| `brand/instagram-highlights/*.png` | Instagram Story Highlight covers: Start here, Course, Rhythms, ECG tips, Quiz, Certificate, FAQ |

How to add a highlight cover: post a Story, tap **Highlight**, then **New**. Name it, for example "Start here". Then open the highlight and choose **Edit highlight → Edit cover**. To use one of these icons, first post the cover image as a Story (you can hide or archive it afterwards), then pick it as the cover. The highlight's name is typed in Instagram and shows under the circle, so the images have no text.

To edit the text or make more images, change `src/posts.html` or `src/brand.html`, then run `node src/render.cjs`, `node src/render.cjs --portrait` or `node src/render-brand.cjs`; the company cover is `src/cover-company.html`, rendered with `node src/render-cover.cjs` (needs Playwright).

---

## Post 1: Launch

**Image:** `1-launch-1080x1080.png`

> 📣 NEW: Basic ECG Interpretation, a self-paced online course from CSHealthED.
>
> Built for paramedic and EMS students who want to read 3-lead rhythms with confidence:
> 🎧 9 narrated units and 34 lessons
> 📈 Live, randomized practice ECGs, a new strip every time
> 🧩 Calipers, rate drills, matching and patient scenarios
> ✅ Unit quizzes, a final exam and a verifiable certificate
>
> Unit 1 is FREE. Try it before you buy.
> Full course: $49 for 12 months of access, on any device.
>
> 👉 [LINK]
>
> #ECG #EKG #Paramedic #EMS #ParamedicStudent #EMT #CardiacRhythms #ECGInterpretation #EMSEducation #CSHealthED

**Alt text:** Ad for the Basic ECG Interpretation course by CSHealthED, showing a heart monitor with a normal sinus rhythm. $49 for 12 months of access; Unit 1 is free.

---

## Post 2: Name that rhythm (engagement)

**Image:** `2-name-that-rhythm-1080x1080.png`

> 🫀 RHYTHM CHECK: can you name this one?
>
> Hint: look closely at the PR interval from beat to beat… and then at what happens after it. 👀
>
> Comment your answer before you scroll. ⬇️
>
> .
> .
> .
>
> ✅ Answer: **Second-degree AV block, type I (Wenckebach / Mobitz I).** The PR interval gets longer with each beat until a P wave isn't followed by a QRS (a "dropped" beat), and then the cycle starts again. Look for the "grouped beating."
>
> Want more practice like this? Our Basic ECG Interpretation course has unlimited practice strips, and Unit 1 is free. 👉 [LINK]
>
> #ECGChallenge #NameThatRhythm #ECG #EKG #Paramedic #EMS #ParamedicStudent #HeartBlock #Wenckebach

**Alt text:** A 6-second Lead II rhythm strip in which the PR interval lengthens until a beat is dropped, with the question "Can you name this rhythm?"

*Tip:* Post the answer as the first comment a few hours later, rather than in the caption, to drive more comments.

---

## Post 3: What's inside / try it free

**Image:** `3-whats-inside-1080x1080.png`

> What's inside our Basic ECG Interpretation course? 👇
>
> 🎧 Narrated lessons: listen while the text highlights along with you
> 📈 Live practice ECGs: randomized strips, so you can't just memorize the answers
> 🧩 Hands-on activities: calipers, matching, rate drills and real patient scenarios
> ✅ Unit quizzes, a 25-question final exam and a certificate anyone can verify
>
> From the heart's electrical system to AV blocks and pacemakers, in 9 units you take at your own pace.
>
> Start with Unit 1 for FREE. No payment needed.
> Full course: $49 for 12 months.
> 👉 [LINK]
>
> #ECG #EKG #Paramedic #EMS #EMSEducation #ParamedicSchool #NursingStudent #CardiacMonitoring

**Alt text:** A list of course features: narrated lessons, live practice ECGs, hands-on activities, quizzes and a final exam with a certificate. "Try Unit 1 free."

---

## Post 4: Story / Reel

**Image:** `4-story-1080x1920.png`

Add a **link sticker** pointing to [LINK], or say "link in bio." Optional text overlay: *"Unit 1 is free 👆"*.

Caption, if you post it as a Reel or TikTok:

> Read ECGs with confidence. 🫀 Self-paced and narrated, built for paramedic and EMS students. Unit 1 is free; link in bio.
> #ECG #Paramedic #EMS #ParamedicStudent #EMSTok #MedicTok

**Alt text:** "Read ECGs with confidence." A heart monitor showing a narrow-complex tachycardia, with the course features, "Unit 1 is free," and "Enroll $49."

---

## Post 5: Facebook / LinkedIn link post

**Image:** `5-facebook-linkedin-1200x630.png`

**LinkedIn** (a more professional tone, good for instructors and program directors):

> We've launched **Basic ECG Interpretation**, a self-paced online course for paramedic and EMS students.
>
> Students work through 9 narrated units (34 lessons) covering cardiac electrophysiology, ECG paper and leads, a systematic five-step approach, and sinus, atrial, junctional and ventricular rhythms, AV blocks and pacemakers. Every unit includes knowledge checks, hands-on activities and practice on live, randomized rhythm strips, followed by a quiz. Students finish with a final exam and a certificate of completion that can be verified online.
>
> It's a good fit as a pre-course refresher, as remediation, or as extra practice alongside a program's cardiology module.
>
> Unit 1 is free. The full course is $49 for 12 months of access.
> [LINK]
>
> #EMSEducation #Paramedic #ECG #HealthcareEducation

**Facebook:**

> 🫀 Paramedic or EMS student? Learn to read ECG rhythms at your own pace: narrated lessons, live practice strips, quizzes, a final exam and a certificate.
> Unit 1 is free 👉 [LINK]

---

## Short posts (text only, or reuse an image)

- **Quick tip:** "The 6-second method: count the QRS complexes in a 6-second strip and multiply by 10. It works on irregular rhythms too. 🫀 More tips like this in our Basic ECG Interpretation course; Unit 1 is free: [LINK]"
- **Quick tip:** "PR interval: 0.12–0.20 s (3–5 small boxes). Longer than 0.20 s on every beat? That's first-degree AV block. #ECG #Paramedic"
- **Testimonial (once you have one):** "'[Quote from a student]' — [first name], paramedic student. Start the course free: [LINK]"
- **Countdown for a class or cohort:** "Cardiology module coming up? Get ahead with Basic ECG Interpretation. Unit 1 is free: [LINK]"

## Suggested posting plan (first two weeks)

| Day | Post |
| --- | --- |
| 1 | Post 1 (launch) on all platforms, plus the Story |
| 3 | Post 2 (name that rhythm); answer in the comments later that day |
| 6 | Post 3 (what's inside / try it free) |
| 8 | Quick tip (6-second method) |
| 10 | Another "name that rhythm" (ask for a new strip, e.g. atrial flutter or complete heart block) |
| 13 | Post 5 on LinkedIn and Facebook, aimed at instructors and programs |

## Notes

- The certificate is a **certificate of completion**, not a license or continuing-education (CE) credit. Don't describe it as CE or as accredited unless that's been arranged.
- The rhythm strips are computer-generated training simulations, which is fine to say if anyone asks.
