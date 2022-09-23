---
title: "Indicators of Attack Failure: Debugging and Improving Optimization of Adversarial Examples"
collection: publications
permalink: /publication/2022-01-01-Indicators-of-Attack-Failure-Debugging-and-Improving-Optimization-of-Adversarial-Examples
date: 2022-01-01
venue: 'In the proceedings of Advances in Neural Information Processing Systems'
paperurl: 'https://arxiv.org/abs/2106.09947'
citation: ' Maura Pintor,  Luca Demetrio,  Angelo Sotgiu,  Giovanni Manca,  Ambra Demontis,  Nicholas Carlini,  Battista Biggio,  Fabio Roli, &quot;Indicators of Attack Failure: Debugging and Improving Optimization of Adversarial Examples.&quot; In the proceedings of Advances in Neural Information Processing Systems, 2022.'
---
Abstract:

Evaluating robustness of machine-learning models to adversarial examples is a challenging problem. Many defenses have been shown to provide a false sense of robustness by causing gradient-based attacks to fail, and they have been broken under more rigorous evaluations. Although guidelines and best practices have been suggested to improve current adversarial robustness evaluations, the lack of automatic testing and debugging tools makes it difficult to apply these recommendations in a systematic manner. In this work, we overcome these limitations by: (i) categorizing attack failures based on how they affect the optimization of gradient-based attacks, while also unveiling two novel failures affecting many popular attack implementations and past evaluations; (ii) proposing six novel indicators of failure, to automatically detect the presence of such failures in the attack optimization process; and (iii) suggesting a systematic protocol to apply the corresponding fixes. Our extensive experimental analysis, involving more than 15 models in 3 distinct application domains, shows that our indicators of failure can be used to debug and improve current adversarial robustness evaluations, thereby providing a first concrete step towards automatizing and systematizing them. Our open-source code is available at: https://github.com/pralab/IndicatorsOfAttackFailure.

[Access paper here](https://arxiv.org/abs/2106.09947){:target="_blank"}

BibTeX: 
>@article{pintor2021indicators,<br>    author = "Pintor, Maura and Demetrio, Luca and Sotgiu, Angelo and Manca, Giovanni and Demontis, Ambra and Carlini, Nicholas and Biggio, Battista and Roli, Fabio",<br>    title = "Indicators of Attack Failure: Debugging and Improving Optimization of Adversarial Examples",<br>    booktitle = "Advances in Neural Information Processing Systems",<br>    year = "2022",<br>    url = "https://arxiv.org/abs/2106.09947"<br>}<br>