// Candidate profile store. Defaults below seed server/data/profile.json on first run;
// after that, the JSON file is the source of truth so an uploaded resume can update the
// profile without editing source code or restarting the server (see services/profileStore.js).
const DEFAULT_PROFILE_TEXT = `
Name: Ritesh Kumar
Degree: B.Tech Information Technology, Heritage Institute of Technology, Kolkata
Graduation: May 2026 | CGPA: 8.34
Direct application email: riteshkr0759@gmail.com
Referral request email: ritesh7882@gmail.com
Core stack: Node.js, Express.js, MongoDB, REST APIs
AI/ML tooling: FFmpeg, OpenAI Whisper, OpenRouter
Frontend: Basic React workflow knowledge, not expert
Competitive programming: LeetCode at leetcode.com/u/levi_ritesh
Internships:
- Backend Developer Intern, Government of Punjab, Mentor Connect platform
- Software Development Intern, Taurus Hard & Soft Solution
Achievement: National Winner, Smart India Hackathon 2024, Team Connexus, 1st place, INR 50,000 prize
Flagship projects:
- Sarthi: AI-powered learning platform; video to transcript with Whisper, notes and quiz with OpenRouter; Node.js, MongoDB, FFmpeg, Whisper, OpenRouter; github.com/ritesh7570/Sarthi
- Connexus / Alumni Connect: alumni mentorship portal with agent-request audit trail for security review; Node.js, MongoDB, Express; github.com/ritesh7570/ALUMNI_CONNECT
Links:
- LinkedIn: linkedin.com/in/ritesh-kumar-919b0121b
- GitHub: github.com/ritesh7570
- Portfolio: ritesh7570.github.io/MY_PORTFOLIO
Job target: Backend SDE intern or entry-level roles in India, remote or Bangalore/Kolkata/Noida
Not targeting: DevOps, frontend-only, ML research roles
Honest skill note: No hands-on Docker, Kubernetes, or CI/CD experience. Do not claim these skills.
`.trim();

const DEFAULT_CONTACT = {
  email: 'riteshkr0759@gmail.com',
  linkedinUrl: 'https://linkedin.com/in/ritesh-kumar-919b0121b',
  githubUrl: 'https://github.com/ritesh7570',
  portfolioUrl: 'https://ritesh7570.github.io/MY_PORTFOLIO'
};

export { DEFAULT_PROFILE_TEXT, DEFAULT_CONTACT };
