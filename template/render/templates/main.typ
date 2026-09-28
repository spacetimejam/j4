// The kit's default CV. Presentation lives here; content lives in the yaml.
// Render with render/render.sh <slug>, which passes --input config=<cv.yaml>.
// Replace this design whenever you like: see "Choosing your template" in
// render/README.md. Date ranges read "from to to" in the yaml's own words.
#import "lib.typ": cv-page, theme-of

#let cfg = yaml(sys.inputs.at("config", default: "/render/templates/configuration.yaml"))
#let theme = theme-of(cfg)

#cv-page(
  name: cfg.contacts.name,
  position: cfg.at("position", default: ""),
  contacts: cfg.contacts,
  role: cfg.at("role", default: ""),
  theme: theme,
  [
    #if "about" in cfg [
      == Profile
      #for p in cfg.about [ #p #parbreak() ]
    ]

    == Experience
    #for job in cfg.jobs [
      === #job.position
      #h(1fr) #text(9pt, fill: luma(90))[#job.from to #job.to] \
      #emph(job.company)
      #if "intro" in job [ \ #job.intro ]
      #for point in job.at("description", default: ()) [
        - #point
      ]
      #v(5pt)
    ]
  ],
  [
    #if "key_skills" in cfg [
      == Key skills
      #for s in cfg.key_skills [ - #s ]
    ]

    #if "education" in cfg [
      == Education
      #for edu in cfg.education [
        #strong(edu.at("qualification", default: ""))
        #if "course" in edu [ #edu.course ] \
        #edu.at("institution", default: "")
        #if "dates" in edu [ \ #text(9pt, fill: luma(90))[#edu.dates] ]
        #parbreak()
      ]
    ]
  ],
)
