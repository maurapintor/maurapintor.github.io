---
title: "Why do adversarial attacks transfer? explaining transferability of evasion and poisoning attacks"
collection: publications
permalink: /publications/2019-01-01-Why-do-adversarial-attacks-transfer-explaining-transferability-of-evasion-and-poisoning-attacks
pubtype: proceeding
date: 2019-01-01
venue: 'In the proceedings of 28th USENIX security symposium (USENIX security 19)'
paperurl: 'https://www.usenix.org/system/files/sec19-demontis.pdf'
citation: ' Ambra Demontis,  Marco Melis,  Maura Pintor,  Matthew Jagielski,  Battista Biggio,  Alina Oprea,  Cristina Nita-Rotaru,  Fabio Roli, &quot;Why do adversarial attacks transfer? explaining transferability of evasion and poisoning attacks.&quot; In the proceedings of 28th USENIX security symposium (USENIX security 19), 2019.'
---
Abstract:

Transferability captures the ability of an attack against a machine-learning model to be effective against a different, potentially unknown, model. Empirical evidence for transferability has been shown in previous work, but the underlying reasons why an attack transfers or not are not yet well understood. In this paper, we present a comprehensive analysis aimed to investigate the transferability of both test-time evasion and training-time poisoning attacks. We provide a unifying optimization framework for evasion and poisoning attacks, and a formal definition of transferability of such attacks. We highlight two main factors contributing to attack transferability: the intrinsic adversarial vulnerability of the target model, and the complexity of the surrogate model used to optimize the attack. Based on these insights, we define three metrics that impact an attack’s transferability. Interestingly, our results derived from theoretical analysis hold for both evasion and poisoning attacks, and are confirmed experimentally using a wide range of linear and non-linear classifiers and datasets.

[Access paper here](https://www.usenix.org/system/files/sec19-demontis.pdf){:target="_blank"}

BibTeX: 
>@conference{demontis2019adversarial,<br>    author = {Demontis, Ambra and Melis, Marco and Pintor, Maura and Jagielski, Matthew and Biggio, Battista and Oprea, Alina and Nita-Rotaru, Cristina and Roli, Fabio},<br>    title = {Why do adversarial attacks transfer? explaining transferability of evasion and poisoning attacks},<br>    booktitle = {28th USENIX security symposium (USENIX security 19)},<br>    pages = {321--338},<br>    year = {2019},<br>    url = {https://www.usenix.org/system/files/sec19-demontis.pdf}<br>}<br>