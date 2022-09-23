from pybtex.database.input import bibtex
import pybtex.database.input.bibtex
from time import strptime
import string
import html
import os
import re

publist = {
    "proceeding": {
        "file": "proceedings.bib",
        "venuekey": "booktitle",
        "venue-pretext": "In the proceedings of ",
        "collection": {"name": "publications",
                       "permalink": "/publication/"}

    },
    "journal": {
        "file": "journals.bib",
        "venuekey": "journal",
        "venue-pretext": "",
        "collection": {"name": "publications",
                       "permalink": "/publication/"}
    },
    "preprints": {
        "file": "preprints.bib",
        "venuekey": "journal",
        "venue-pretext": "",
        "collection": {"name": "publications",
                       "permalink": "/publication/"}
    },
    "others": {
        "file": "others.bib",
        "venuekey": "journal",
        "venue-pretext": "",
        "collection": {"name": "publications",
                       "permalink": "/publication/"}
    }
}

html_escape_table = {
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;"
}


def html_escape(text):
    """Produce entities within text."""
    return "".join(html_escape_table.get(c, c) for c in text)


for pubsource in publist:
    parser = bibtex.Parser()
    bibdata = parser.parse_file(publist[pubsource]["file"])

    # loop through the individual references in a given bibtex file
    for bib_id in bibdata.entries:
        # reset default date
        pub_year = "1900"
        pub_month = "01"
        pub_day = "01"

        b = bibdata.entries[bib_id].fields

        try:
            pub_year = f'{b["year"]}'

            if "month" in b.keys():
                if (len(b["month"]) < 3):
                    pub_month = "0" + b["month"]
                    pub_month = pub_month[-2:]
                elif (b["month"] not in range(12)):
                    tmnth = strptime(b["month"][:3], '%b').tm_mon
                    pub_month = "{:02d}".format(tmnth)
                else:
                    pub_month = str(b["month"])
            if "day" in b.keys():
                pub_day = str(b["day"])

            pub_date = pub_year + "-" + pub_month + "-" + pub_day

            # strip out {} as needed (some bibtex entries that maintain formatting)
            clean_title = b["title"].replace("{", "").replace("}", "").replace("\\", "").replace(" ", "-")

            url_slug = re.sub("\\[.*\\]|[^a-zA-Z0-9_-]", "", clean_title)
            url_slug = url_slug.replace("--", "-")

            md_filename = (str(pub_date) + "-" + url_slug + ".md").replace("--", "-")
            html_filename = (str(pub_date) + "-" + url_slug).replace("--", "-")

            # Build Citation from text
            citation = ""

            # citation authors - todo - add highlighting for primary author?
            for author in bibdata.entries[bib_id].persons["author"]:
                citation = citation + " " + author.first_names[0] + " " + author.last_names[0] + ", "

            # citation title
            citation = citation + "\"" + html_escape(
                b["title"].replace("{", "").replace("}", "").replace("\\", "")) + ".\""

            # add venue logic depending on citation type
            venue = publist[pubsource]["venue-pretext"] + b[publist[pubsource]["venuekey"]].replace("{", "").replace(
                "}", "").replace("\\", "")

            citation = citation + " " + html_escape(venue)
            citation = citation + ", " + pub_year + "."

            ## YAML variables
            md = "---\ntitle: \"" + html_escape(b["title"].replace("{", "").replace("}", "").replace("\\", "")) + '"\n'

            md += """collection: """ + publist[pubsource]["collection"]["name"]

            md += """\npermalink: """ + publist[pubsource]["collection"]["permalink"] + html_filename

            note = False
            if "note" in b.keys():
                if len(str(b["note"])) > 5:
                    md += "\nexcerpt: '" + html_escape(b["note"]) + "'"
                    note = True

            md += "\ndate: " + str(pub_date)

            md += "\nvenue: '" + html_escape(venue) + "'"

            url = False
            if "url" in b.keys():
                if len(str(b["url"])) > 5:
                    md += "\npaperurl: '" + b["url"] + "'"
                    url = True

            md += "\ncitation: '" + html_escape(citation) + "'"

            md += "\n---"

            ## Markdown description for individual page
            if note:
                md += "\n" + html_escape(b["note"]) + "\n"

            if url:
                md += "\n[Access paper here](" + b["url"] + "){:target=\"_blank\"}\n"
            else:
                print(f"[{pubsource}] " + "Skipping: ", b['title'], "no url found.")

            skipkeys = ['annote', 'abstract']
            bibentry = bibdata.entries[bib_id]
            bibentry.fields = {k: bibentry.fields[k] for k in bibentry.fields if k not in skipkeys}
            md += "\nRecommended Citation: \n>" + bibentry.to_string('bibtex')

            md_filename = os.path.basename(md_filename)

            with open("../_publications/" + md_filename, 'w') as f:
                f.write(md)
            print(f'SUCESSFULLY PARSED {bib_id}: \"', b["title"][:60], "..." * (len(b['title']) > 60), "\"")
        # field may not exist for a reference
        except KeyError as e:
            print(f'[{pubsource}] WARNING Missing Expected Field {e} from entry {bib_id}: \"', b["title"][:30],
                  "..." * (len(b['title']) > 30), "\"")
            continue

