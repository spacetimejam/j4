from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Preformatted
from reportlab.lib.enums import TA_LEFT

teal = HexColor("#2b6777"); ink = HexColor("#1a1a1a"); panel = HexColor("#f2f5f5")
h1 = ParagraphStyle('h1', fontName='Helvetica-Bold', fontSize=20, leading=24, textColor=teal, spaceAfter=12)
h2 = ParagraphStyle('h2', fontName='Helvetica-Bold', fontSize=13, leading=16, textColor=teal, spaceBefore=14, spaceAfter=6)
body = ParagraphStyle('body', fontName='Helvetica', fontSize=10.5, leading=14.5, textColor=ink, spaceAfter=6)
bullet = ParagraphStyle('bullet', parent=body, leftIndent=14, bulletIndent=4, spaceAfter=4)
code = ParagraphStyle('code', fontName='Courier', fontSize=9.5, leading=13, textColor=ink, backColor=panel,
                      borderPadding=8, leftIndent=4, spaceBefore=4, spaceAfter=8)

import os
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "Job Search Kit - Getting Started.pdf")
doc = BaseDocTemplate(out, pagesize=A4, leftMargin=2.2*cm, rightMargin=2.2*cm, topMargin=2.2*cm, bottomMargin=2.2*cm,
                      title="Job Search Kit: getting started", author="Job Search Kit")
doc.addPageTemplates([PageTemplate(frames=[Frame(2.2*cm, 2.2*cm, A4[0]-4.4*cm, A4[1]-4.4*cm)])])

def P(t): return Paragraph(t, body)
def B(t): return Paragraph(t, bullet, bulletText='•')
def H(t): return Paragraph(t, h2)
def C(t): return Preformatted(t, code)

story = [
 Paragraph("Job Search Kit: getting started", h1),
 P("This guide takes you from a bare computer to the moment the kit's own setup wizard takes over. Nothing here is difficult, and none of it needs programming knowledge. Allow half an hour."),
 H("What you are setting up"),
 P("The Job Search Kit is a private, AI-operated working environment for a job search. Once it is installed, an AI assistant works inside it with you: assessing whether roles are genuinely worth your time, tailoring your CV to each one, drafting cover letters in your voice, prepping you for interviews, and keeping an application log so nothing goes cold. Everything lives in a folder on your machine, and it never applies to anything on your behalf."),
 H("What you need"),
 B("A computer running <b>macOS</b>, <b>Linux</b>, or <b>Windows</b> (Windows works through WSL, step 1 below)."),
 B("An <b>AI coding assistant</b>. The kit is built for <b>Claude Code</b> and works best with it; a paid Claude plan (Pro or Max) is required. Other tools that read AGENTS.md files (Codex, Gemini CLI, Cursor) also work."),
 B("Your <b>current CV</b> and links to your portfolio or LinkedIn, for the first session after setup."),
 H("Step 1: open a terminal"),
 P("The terminal is where you will paste a handful of commands. That is the extent of it. One thing to know before you start: when a grey box in this guide shows more than one line, each line is a separate command. Paste the first line, press Enter, wait for it to finish, then paste the next."),
 B("<b>macOS:</b> open <b>Terminal</b> (Spotlight: press Cmd+Space, type “terminal”)."),
 B("<b>Linux:</b> you already know where it is."),
 B("<b>Windows:</b> the kit needs WSL (Windows Subsystem for Linux). Open <b>PowerShell as administrator</b> and run:"),
 C("wsl --install"),
 P("Restart when prompted, open the new <b>Ubuntu</b> app from the Start menu, and do the remaining steps inside it."),
 H("Step 2: install git"),
 P("Git fetches the kit and keeps a history of your project. Check whether you already have it:"),
 C("git --version"),
 P("If that prints a version number, move on. If not:"),
 B("<b>macOS:</b> run <font face='Courier'>xcode-select --install</font> and accept the prompt."),
 B("<b>Linux / WSL:</b> run <font face='Courier'>sudo apt update &amp;&amp; sudo apt install -y git</font>"),
 H("Step 3: install your AI assistant"),
 P("For Claude Code, run the installer, then start it (two commands, one at a time):"),
 C("curl -fsSL https://claude.ai/install.sh | bash\nclaude"),
 P("The first launch walks you through logging in with your Claude account. When you can type a question and get an answer, you are done here: type <font face='Courier'>/exit</font> to close Claude Code and return to the terminal. You will not need it again until the wizard hands back to it at the end of setup."),
 P("If you prefer a different assistant, install it per its own instructions. During setup the wizard will ask which tool you use and prepare the project accordingly."),
 H("Step 4 (optional): Node.js, for the portal"),
 P("The kit includes an optional web portal that lets you submit job adverts from your phone and receive tailored PDFs by email. It needs Node.js 20 or newer. Skip this happily; you can add it later."),
 B("<b>macOS:</b> <font face='Courier'>brew install node</font> (or the installer from nodejs.org)"),
 B("<b>Linux / WSL:</b> <font face='Courier'>sudo apt install -y nodejs npm</font>"),
 H("Step 5: fetch the kit and hand over to the wizard"),
 P("From here the kit guides you itself. Back in the terminal, run these two commands, one at a time (the first downloads the kit, the second starts the wizard):"),
 C("git clone https://github.com/spacetimejam/job-search-kit\ncd job-search-kit && ./setup/setup.sh"),
 P("The wizard checks your machine, asks a short set of questions about you and your search, and builds your personal project folder, named after you (for example <font face='Courier'>job-search-sam</font>). When it finishes, it tells you the final step: move into that new folder in the terminal and start your AI assistant from inside it, for example <font face='Courier'>cd ~/job-search-sam</font> and then <font face='Courier'>claude</font>. Starting it from inside the folder is what lets the assistant see your project. Once it is running, say <b>“run setup”</b>. The assistant then interviews you properly, builds your profile and CV materials, and from that point on you are running your search together."),
 H("Good to know"),
 B("<b>Everything stays on your machine.</b> The project folder contains your CV, salary expectations and application history. Treat it as private, and back it up as you would any personal documents."),
 B("<b>The kit never applies for you.</b> Every application is tailored, checked by you, and sent by you. Quality over volume is the whole philosophy."),
 B("<b>AI sessions cost money</b> in the usual way your Claude (or other) plan meters usage. A tailored application is a normal working session, not a one-line question."),
 B("<b>Stuck?</b> Ask the person who sent you this guide, or ask your AI assistant itself: once the kit is installed it knows how everything fits together."),
]
import sys
doc.build(story)
