---
layout: archive
title: "Publications"
permalink: /publications/
author_profile: true
---

{% if site.author.googlescholar %}
  You can also find my articles on <u><a href="{{site.author.googlescholar}}">my Google Scholar profile</a>.</u>
{% endif %}

{% include base_path %}

<h2>Journal Articles</h2>
{% for post in site.publications reversed %}
  {% if post.pubtype == 'journal' %}
      {% include archive-single.html %}
  _______
  {% endif %}
{% endfor %}

<h2>Conference Papers</h2>
{% for post in site.publications reversed %}
  {% if post.pubtype == 'proceeding' %}
      {% include archive-single.html %}
  _______
  {% endif %}
{% endfor %}

<h2>Preprints</h2>
{% for post in site.publications reversed %}
  {% if post.pubtype == 'preprint' %}
      {% include archive-single.html %}
  _______
  {% endif %}
{% endfor %}

<h2>Other</h2>
{% for post in site.publications reversed %}
  {% if post.pubtype == 'other' %}
      {% include archive-single.html %}
  _______
  {% endif %}
{% endfor %}


