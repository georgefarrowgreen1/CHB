<?php

// The crown for the header line of every email. The image is embedded as a base64
// data URI so it travels inside the email — no external URL to break and no
// dependence on the site domain. It reads on both the light and the dark card.
//
// A data URI cannot be stripped by the image blocking most clients apply by default,
// which is worth its bytes — it is the one thing that makes these emails look like
// they came from somewhere. But it was stored at 240x240 and DISPLAYED at 72, so it
// is now 144: 2x for a retina screen, which is all the <img> width/height can ever
// ask for. 14,026 base64 bytes down to 8,864 — every email about 5KB lighter, for no
// visible change at all.
//
// DO NOT QUANTISE IT to shave the rest. Measured: a 64-colour palette reaches 2,476
// bytes and the per-pixel arithmetic calls it fine — composited on this header, five
// pixels of 5,184 differ by more than 8/255. It still BANDS, visibly: the rose-gold
// gradient becomes stripes, because banding is a STRUCTURED artifact that a mean
// per-pixel delta underweights. Octree at 128 and 256 colours bands identically and
// is barely smaller, and Pillow will not run a better quantiser on RGBA. The
// arithmetic passed and looking at it did not, which is the whole reason to look.
function email_crown_header($bg)
{
    $src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJAAAACQCAYAAADnRuK4AAAZvklEQVR42u2deZxcVZXHz7n3bVXV3UlQEHAGxPnIhLSjwwiyCCbNTlhEoGqITkQGJBADgSQkAZFXTyVkIQYMhkUxhhmWecUyrAOyJM0mjDA4jN0ioyggwhgmSS9Vb7v3nPmjupIeIECS6nTn0/fL537yB8mnqu479/zOPefc+wAMBoPBYDAYDAaDwWAwGAwGg8FgMBgMBoPBYDAYDAaDwWAwGAwGg8FgMBgMBoPBYDAYDAaDwWAwGAwGg8FgMBgMBoPBYDAYDCMaBkBmRjMTBoNhO3sfZvzlTUsKq1cuG8vMyAzGE70HwkzBexhPGEpEZHfsTt/+i53HXYuIDJXQzJXhQxiP7wtAhJcfuHHCK/et2vDqg//ML939k8MAAMIwlGaGjAd6f9rb64GzEktQ4JgkzcAScumvwmtaGtJmJskY0Oalq1TSv7lr5T+4jj25vxarOMmU61h/azv5C0qlkoZKxczZIMxqGhQ0AwC8XLlud3TdZzXR7pnSDABCCCTXdmoJ6QM+fdKZ3ez7AoOAzKwZD7SJSkUgIivL/q7rOB9Psowa86O0ZilFi4WwxPd9UZc5s/iMAW2UrqLEUkl33fWjyY6UZ2zo69MIKJkZmBkQUPb09mtHWpNPbd/9H7FU0mZXVmfU7yoYAMsTinD51MkthVwuZOadM0XvkncEBGZmS8r9v3H88eHHpkztBQDR2dnJxgONZsJQBEFAY8eMm+c5zoRqFGsAEEwMgwcAiChO2LHl7pbH30FEbm9vH/UyNqonoBEMv1i5bj9LWE8maWoRs0BE3HywTZT3PFRaH/M3xWk/C8NQlkolPVrn0BrVi6dcBh/AAcZlCOBqrTUKgcz8Prs1AK0JBeKSB/7p6meO7erqZ2ZERDYGtIWxAwLssJPGYSgQUf/yX1ack3PsQ9b39msphRyQq81bHYKoRZEe19b2mY9JPQeD4LLV9XlUO7gSbdWzFNvwicy+LzgM5Y6WnWXfF1gq6Wdu+sFeEoXfV4sIEETd87z/YGYARNFfrWrXFhf8+y0r9u0IAsW+v6PFkxiGRTlQnuFtsbyt4verV47dq+OMDZtcuy/WrAExaVJZj3R3zvU4h1645Zo7PMc9uadaIyFwiwyAiKmtkBNxmq35rbXmiGJxAiOO7OQiM2NlIJM+OG57YeWysfueceGG7SJhzL5ADMjSuX3fWlP5phB8u+taDyOe/L8AQAABcKPoWCzSSDOmsF5p1y/cvLzo2s7JPf1VLcQHS9e7XDei6Omv6bGtLZP2rB5yNuLMaxulkJFqNIioAUADADxz9dVt0KYPlVJOjRTfAwC3NBbWkBoQYkDMvgD4+zV/7rz97LZC4da33l7/xp87K49FSXYfa/0EHlt6s/H3V6/2rbVr27lYKtFwx0y+D6JYKtFDK5bsgkIuidOMmFm8X9D8Pg8GEBCrUUSu7Vz2xKqF90Op9Lrv+yIY/jIHhmFR7Nw1ARFRNYzmhZXLxvYrdWjOc4+NkvSYjxRa9uqtxc/9cb2+a2s3AlsVRJfLAEGA/OLNK6YnH23b37atv1KaprqONVVl8MdXf/bPT0pp3fn2hnWdf9sx/c+DV39xGD1TuT1EhBI91+oGjiX3rAfOUhBv3VdBAJEkmc61OrvmRP57CPC1sL1dDLenKZVKulSqaACAB66+fOdxrd7+wPDliOhw17b3QgCwpIDeavS/UVqbWpr9rcjv7RV1BdlOMVDDXb/60M0nSCnu6Y+iVCBKS0qZ9zxgZtDEv8uy9DHPdu7tS7POvSdP7R387ysAUNxOxtTI1zz7T1cd7lnOg7UoQa5vIrZ5A4AIKu95mKnsS/tNPf/+7ZUbqhtNSQAU/19M88zVV7eJVpiYqPRE27YmAuKnLIEQpxlkmSbNlLXl826UqrMmnj37Rt/3rSAI1FYuom3aCksslfTvHrjp2kLOO2d9b69GFIKBCQDAtWyZy7mQZQoyrV7NO879fdXoQbsVnxgcgG8HmUPf93HSJ8BpETs9IwR+tpZkLAU2ZfdIDOQ5tmDmXydpdMDDr9eqQRAwDNFvYd/HNQCiY9BDf2HlsrE9SXxozvWOSTJ9nCXFnrYlIU5SSDOlARhQCGRN3NKSl6lSdz/y+pyT29tD3JZ5x2b8mJf2/cuC6zrPIOKEWpyQRCEGckUETEQM0nNszHkuKK0hy7LfCykeBZJ3vd4f/+KLpTPXDqXMNVbYMz+9yi94bnlDb78WUjS1Dkia9Ni2Fhkl6eLPnz5z3mrftzq2clW/d0wTvmv3FC6cN+bju4w7kJQ8lZgPs6T8pC0lRGkCaaoYBWoEFI10DTOzZUm2pFgXZfKAo6bPeuWybYzZtnkFbmzCuu/GI/KOd39fLZIwSBoQEAABiIgZgBAAXdsWnueC1hqY+L8TpTo9x7kn0W937j15ZlNlriEnT9y49LM5x34qSVWOiLD+xZqpJ8ACkfKuk/Sl8WFfPPOiZ7dFypgBK6WigOL/l6enly7NcSsdlGk6wbLFYczwGVtIiLMM0kzRQHQvhBAIDMADjgXrnlKNKeStapKcddi5829shtQ2ZRJ59WoLOzrUb+75ybKWfO6CdT19SghhbW73AgDEzIwI4Nq2zLkupEqBUupV13Pur1WjBz2wntjry4NlbrU1adIaQtwyaQjDUH5y/XpBbu3fpJCH90cxCSGGJNBlIl3IeTLT9Piv/7D+6K+3t2dYKtEWfN/3lKenw6W5+M/qYMsRx2hNxyHweM+xMUkziAeMBhEREMTm1gVp0q0tOZmk6u6O6fNPalac1hwDYkYol/HJvb0xu4/d7XEi/nSUpCTwg5NzdZljYmbpug7mXRdSrUArekWgeAxI37rhrez5/aZN63mXZ/oA7W54x6d/smya59jX9VVrChGHtP7HTKqtULCiKDnv4G/MvuZDPKjNytPOY8bui4gnkuajEXEf17YxzlJI0wwYUCGiQPwQ1QQGsqRAS8o3ehL+wgkz570+kBfiEWFAg6Wi664fH+461kO1KAYAlFvyTZiYGZgQEF3bFjnXgThTIIV4MUmzx1zXudeprv35HqXZ0TuM5F2rvJGPefiqhXu0tDm/0Jp2zrSG96u0N2trJIUAS8p1tUh/7vAZF726mdwQhmEo3ilPWS49SCk6QdryMCb+jG1LSDMFSZoxA2hEFAggtqR6xcy6kM/JOEm+ctT53761mQnPpk5mI3DsuvNHy1py3gXrenq1kHLLg1UeqBYQMQqBOdcSruNAnKbMjC9JFPdnpB9szdqe3qNUit7boIvyk+vHiVSOX2U71pS+/poWArdLAx0R69ZCTiaZutXTLae/Mu4RauRl3snTS5fm+mV8sGPBMYrhOAAY7w7IU5opYiau2wzURWorvktbIS/jLLv1yPO+9ZVmpxiaGgusCQJi3xd9r9f8WhR3e64rtSZ6Z3PWB456K6lAgRKYRS3KaH1Pv4qiBJloH9uSc5Dh4ard+/xv/vUni1avXOkNFHRxkzes6A20x74IfFpfX1UjwsYW1aEeiCD7+mtaIk7phd6/K5UqetCZMmRmXOn73qPLFyyqWvHzIOBhIe05zLxPnKTY01dTcZpRPS4XkoEFAyMxw5YMrYlty8JM6dd7q+lcZsaurq6mphaaakABAEF7Ox44c2ZvmujzEUEj1wOcLf3xxAxE9T/rEwgWA0KUZLSut09FSQxK6X3GtOTnfqQQXYCIzJtiCWLfF/299q8V0WM5z5WkSTPDdjAgAK1J51xHKqUe16Bf8n1flOoyC2G9jYQ/NkZc0Jr35irS+yRJAj39/SpJ04FeWraAWTAxEBFs8QIkBiAGBtaOlKIWJ/NOmR/8sVKpNL3M0vTdCJZKevXq1dZnp5zzaJypa9paCpK01s16QAAs6iUYhDTL1Ftvr1OWZc978fbrx2OppAfaKhjKZT5p3ry+JONZWqsIBSIRcd2Ihm7UZRdRM0Wgxawjp83v2RiK1A1J33OlP96Sct7a9RtUprLGbstirreUUBPmSWmtC55nRXFy0/FzyrcOSFfTa3RDsp3t6OjQzL5Y/z/q0locP++5rqW1pq1ZSe8zkBmsTGkUiGOZaDFzvcuwscPgMJRHfHPui2mmlrbkPKEHLGgoBxFRq+eJLNM/OHT6nOc5DOXGVV8uAzOgBFwsAMcqTQgMVv3yhiZ+ByZybEsmmXol6+PZzIylLUsnDK8BAQBXKu3YMWNGf6SS8wWKmkBkqosZNHMAgOztq2rXsk544bYVUxCRNsYbpRIx+yJWyZJanLzoObakITQiIibHtmUtTl6KsmgB+76ATdIlEZEeWHLpFMe2Tuir1jQwSKIBqW7eYNbMUliUZtmsE4Pg7YEi65DUG4esclwakLLPT5n5dBxH32/J56RWmpovGwzELKIkIylwwUMrluxSLBbJ90HggCFPnhn0ZsyzJQoFzDwoUG/eIAZgYonIKlNzJ88Meivt7YgA7AOIYrFIN/mzd0EhF8RpSgQsaAiMWJPWhVxOxlG88ktzv3s389AWdoe09WBSR4dm3xe/0vHCKE6ey3ue1FpTs1cdAGIUxexIa8+PtHllRORye4gbDdn3rSOnX/xIkmarWnM5qal5MdnGB6cHstBK3XrEzEvv9X3fajy49jBEROSxuVzZknLPJMkY67ux5npA1mRbtpVk2e/6SX/L930BUBzS3qQh72VudLk9u2rZQa7jro6T1OJ6INzsz2YEoJzn6kRnR33+qzM7GzkPBkABwI9d4+9K4P47E/9FpjV/qCzuh0pbIVkCUQq5Vivc/8gL5r/GDIgIHBZDWaqU9J2LLp7oCvdncZLIZrWRvMfD1J5jQ6TSE0+9ZOED26OtZMibnxCROAzlAadf+PNUZUtaC0MlZYCKCLUmBxmvfHrp0lyxnvNABOB/CUPZMSN4Sym+xLEt5GbuyLRmz3EwIx0cecH81+oXVAEDAHZN6OLwwgtzksSVWmtHk8ZmB83MDFTfdckk08tPvWThA4M94A7tgd5RJHTyf7XTU5YQf1eNkw9VK9tCawXSWo9ra5G1KJ1/wNdnLhq8Clf7vrUGgA7eybrXs+3JfbV4m7PTTKzzOVemWnf27PqfhxehCI0yQeOz77riknmuZS/sqUZaDkE2nJnItR3BwN39iX3QbwH6gyAA2IoOwxHngTbuyrq7sSMIYkhpBgDEYqD01dxAlgAQRV+1RgL5ktXXXzm+VCrpeg83wBoACoKASPNcrXWPlI3c0FZv2VnUa3g1pbI5pVJFlwcyvY2cz83+rPHAcEl/FBMCiCHZdQEyAGiVZedPDYLegSPX26Uve7v175YqFc1hKA8468KfJ2m6tDWfk6ybH8wCM6aZYiFlm+fgYgZAqNTPsAdBQKt93zp21mVdcaYW5hxHDOQWtlI2iPI5TyZZtvy4WcFzA41rBABQqT9E9KSzWKBoU0pzPUz74LNnWzI0ad3iuTJV6odFf8mjq/2J1vY8ar3dDwQy++KnZXDG7zn2ESHEF2px3HQp4/oPU/mca8VKffXQf5x9y2Ap831fHLBunS0+sfMTUuL+UZISbuG5MGYm17YFMLzUk1YP7Iq8vkYba+Ozbv/OvK9Ylry5FiUKsJ49b7p0OY5gou6YooN+Czv1D2Er7fB6oI2UAc4IgjhW2QwE7pWinmAkJmjWYCbQRDJJUhAEVzy1MTdUl7Lu7m6cvHx5okjPQYYEEZm3TE4ZGFgKSVrz3NL8RT3l7m6sK5dfz/nMnr0LMV0RpwqISNaz59S0QUSMgIwINaX4nKnB8t729m6E7Xx0arsbEA7ISMfZc38ZJekVec8bkl0ZAGCcZNq1rT3IYn/wdSyVSkX7/kTr+IuCx+Ms+1FLzqt3DXzYepcmKniejOPktskX+fdyGEqs1Ns12tu7ERHZLqBvS3uPJE11o3OrmUNropzryjRNvz/lu0ueWO371uZaRoaSYblgalVnJzOzeOj5m54Zq9o6XNf5RJoqDQCimbOMiCJJU21b1n7/cMzEzuPPOPf3YViUlUo3r1nzBwYA0YrZ8zaIk4TAjyjS/MGyzmRJiQSwNu2Pp9y25smecqUCnZ2dHBaLshRU9KqLL5zoWOIH1SRhhOa3kRAReY4jldbP/bEKZx181FH6jGE6zDhcFwIwlMswbdoNWZSl55GmfoEIzZYyYgJNjMwshbSWXu/7eYAi1JN8dY/0lW9d8T8ZJfMtKXCgDL75Fol64MyubQulVPDlYNEfGi0SPGB41599dt62xFJikKwJm1xABiauv8KDONFpdv5FS5dWy5tCv1FjQIBBQL7vW0fPuPSXWaovz3uuJM16CKRMVONEebb1uU99LH9eqVTSlcqmHmQuFuWJcxfcEafZHQXXk0qT3pxLIyKd9zwZZ0nn8zVxQ2OrDgBQCYuiVKnolo8WzrOl9blanChAEAzN/U8RUYvnyEyrJV9dePXPw2JRDueNscN6JUkQBDoMQ/nyi68s7Y/ip/KeY5HWupnBJhMBM8v+WkQS4eIHf3D5+FKppBsBdXnCBGYGzFK4WCn1tiUF1pso39XcxgCARLoWpzRn8EnOesNYRa+cNWM8A1xcjSICANls76MVUc62ZS1On1VvrL/c931RqlSG9Rz+cN9pw11dXTzthhsy1uo8IuoTKGCrOxg3M4AZU6VZII6xERb7Poj27m5kAAyCgCqVojj1su/9d6LTy3OOLZhBQ724vkm6iKjFy4k4zZYXL13wXBiGEgekq7u7G30fBDpisRBiTKbrp5aa+RuImFEIZqa+JNHnnrFqVTyc0jVSDGhjcu/ImZe9ECXZgrqUETVTx+pn7UD2VmvatqwTDhn3ndNKlYquDLTAFosVCsOifO3N6rVxph73bMciqkfUDACaiBzLllGavIRpbWEYhrJYrFe5K8WiqFQqes/qN09zpDyhP4o0Asvmt2nUvU+aqgVnfX/5C74/0RoJl52PiGt+V3V2Evu+eGynN55pSVomera1V5xlBIDY5HgImBhQyP1OOuzQW371xtrapEmd2NEBPGFCEecvXqyKhx7chRK+polk4zJxZmbbtiDTfOYp/pUvFgHEp0sl8gHE2mIRztxnn50xZ9+WKRrDutHW3LzdJGuinOPINFNPpr3pOZ87/ngIglUj4h6iEXUt27RpN2Rxmk1TmtbbQvJ7xiLbMJhZxFlKtiX3LFjSD4KA2gf6hoIgIC4W5Sn+wl8orZcVPFcQkyJNusXLiSxTt5566YJ7wzCUpUbOp1jEIAhIt0hfCrlnkmbEAGJIpAu4LwN93rQbbshG0jMbUXcbNkoA9y/1Z+Rcd3lfNRqSs1zMQJ7rkFL6iMmz/c6wWJSlSkXXjwaVsTI/brVa5VPM1K4UsW1Zb1Oc7P9fVsvr5XKZEZGLxaKsVCr6+gvPnWhL+UiaZQKb3V1Ql0/dms/JJEnmnrXsuiVhWJTDkTDcIQyoYUTFYpHuv7L8kGvbR/ZHcYKiyVLLQJ7jCAZ+7rWX3vjitBtuUAMZRG48oNv8iya7tnWPECiTVE8vlRddO6iehgAAZ599tvX5FutxRNwvTjPCJnp0rBu6znmOmyn98DeuuvboSrGeKhhJz2vE3Sza1dXFiMiK9HlKq74xrQW34HpWi5dr2mjN5RxEsHZqbT1wt0/t/j1mhsrGM2UV7fu+dVqw5IE0U/clqfrPR/60/seDj8WExaJgZtgvJ743plA4EICtguc6ec+1mjU817FaC55LmvqqnJyHANxVqYy4y0tH5PW8jbPk9y689FQWeLwmrgFzs6WMhEAphOhxoLV89EUXVRt3Xzc+f9X8WXsLQS1TF1z1H4PuEEQA4Jtmzy7UVF+ZGMYQaV3vmm3qg9EWijxpvO/cFdffPkLuXtxxGGF3T+PwzsXIfSXFiH3VASJyWCzK9UccIfb+058YJjX5A9YAvLz7m7j3n3bjzd0k5vu+KA+UXd77/0+0dn/zr3Hv3XYbAmlZAy+/+dc4bv16QqyM2HdxjOgb5pl9MXDQdNRSLtevVjaatGNLmJmLHUnCOCxKRNSPLV80L5eXh1XjTOEoe7cZA1DBs62oph9DxEX1tyqOPCkbcZbduFH1/qX+11ry+VVa6/reaHS6HpBSQn+tdvpxs4ObtuU+51FhQI2M8B0Lvr1/wbMfTVVW0ET1TsXRCUkhpGPZ1WqcHX7KJd/9RWOORsoXHDHvTPV9X8z44Q/5DjvbzbOtu5TWH4/TlAHAGnifxWgcMlOKEdFzpDjklIlfuLO4/Lo+fwS9q3WkeCAMw1Ds3NWFb1vx3a7jTO6vRgNXBY/qd9oCAAIRqZZCzkrS9IGPKu9La9vbeaju+9khDWhT/WnOYs9xLuqt1ZRAYYFhk5YxqbZ83orTdMlpwZVzR0pRddgNyPcnWkHQqX4674KzCjnnR/1RrOu3ZqDZxr9zM89ALTlPVqP0G19fdNWPG3M3ag2o8fK6G2dNP8R1vX9LszSv6zUnYzybMSGJyI7t1JIkPvbM7694sjGHo86AfB9EEABdM/30XT2v8CQzfDJTSgOiRGA25vJeuSFEYNa2ZUlEeCWOq4fMWLHqrcZcjhoDYmYslxHh5Sk77bHb2Dtd2zm0WotISCmMmXyIeEhrKuRzIsnSJ157c8PJsPet68pl5uF4id+wGRAi8jXTp+9qCXWEBuhHZkmmfPGhEIjMiFoCtCiyHpmxYsVbo/nd9YYdOskwzJ8fFotGtraBgYOFxvMYDAaDwWAwGAwGg8FgMBgMBoPBYDAYDAaDwWAwGAwGg8FgMBgMBoPBYDAYDAaDwWAwGAwGg8FgMBgMBoPBYDAYDAaDwWAY1fwfegLMaQrzlSMAAAAASUVORK5CYII=';
    // THE HEADER IS THE RAIL'S BRAND ROW: the crown beside the name, in the back
    // office's one font. One line, on the same left edge as everything below it.
    return '<tr><td class="ec-pad" style="padding:20px 28px 16px;border-bottom:1px solid #E2E3E3;">' .
        '<img src="' . $src . '" width="24" height="24" alt="" ' .
        'style="display:inline-block;width:24px;height:24px;border:0;outline:none;vertical-align:-7px;margin-right:10px;">' .
        '<span style="font-family:' . email_sans() . ';font-size:15px;font-weight:600;color:#1B2A34;letter-spacing:-0.005em;">Cottage Holidays Blakeney</span>' .
        '</td></tr>';
}

// ============================================================
//  mailer.php — minimal, dependency-free SMTP sender.
//  Speaks SMTP directly (EHLO / STARTTLS / AUTH LOGIN / DATA) so no
//  external library or Composer is needed on shared hosting.
//  Public entry point: send_booking_emails($booking) — sends a guest
//  confirmation and a separate owner notification. Never throws; returns
//  a small status array so the caller can log but not fail on email errors.
// ============================================================

// ---- Email preview (back office) ----
// Turn on capture, call any send_* function, then take() the messages it built.
// smtp_send short-circuits into the capture buffer instead of connecting, so we
// get the EXACT bytes that would have been sent — no duplicated templates, no
// SMTP, no side effects.
// Run $fn AFTER the HTTP response has been flushed to the client — the same
// pattern chat uses (messages.php chat_notify_owner_deferred): the visitor
// isn't kept waiting on SMTP handshakes, and a slow mail server can't gateway-
// timeout a request whose real work (the DB write) is already committed.
// Without fastcgi_finish_request (CLI/cron) it still runs at shutdown, i.e.
// exactly where the code sat before — never earlier, never skipped.
function mail_after_response($fn)
{
    register_shutdown_function(function () use ($fn) {
        if (function_exists('fastcgi_finish_request')) {
            @fastcgi_finish_request();
        }
        try {
            $fn();
        } catch (\Throwable $e) {
        }
    });
}

function mail_preview_start()
{
    $GLOBALS['__mail_preview'] = [];
}
function mail_preview_take()
{
    $c = isset($GLOBALS['__mail_preview']) && is_array($GLOBALS['__mail_preview']) ? $GLOBALS['__mail_preview'] : [];
    unset($GLOBALS['__mail_preview']);
    return $c;
}

// ============================================================
//  SMTP transport — split into open / transmit / quit so ONE connection can
//  carry several messages (smtp_send_batch): the owner-copies loop and the
//  newsletter used to pay a full connect + STARTTLS + AUTH handshake PER
//  message. smtp_send() keeps its public contract (one message, then done)
//  and adds a single retry on TRANSIENT failures — but never after the
//  message payload has been transmitted, so a retry can't double-send.
// ============================================================

// Read one (possibly multi-line) SMTP reply. '' on read failure/EOF.
function smtp_read($fp)
{
    $data = '';
    while (($line = fgets($fp, 515)) !== false) {
        $data .= $line;
        // Lines like "250-..." continue; "250 ..." (space) ends the reply.
        if (isset($line[3]) && $line[3] === ' ') {
            break;
        }
    }
    return $data;
}
function smtp_cmd($fp, $command)
{
    fwrite($fp, $command . "\r\n");
}
function smtp_code($reply)
{
    return (int) substr(ltrim($reply), 0, 3);
}
// Transient failures (4xx greylist/rate-limit, connection trouble) are worth
// one retry; permanent rejections (5xx: bad auth, relaying denied) are not.
function smtp_transient($reply)
{
    $c = smtp_code($reply);
    return $c === 0 || ($c >= 400 && $c < 500);
}
function smtp_quit($fp)
{
    @fwrite($fp, "QUIT\r\n");
    @fclose($fp);
}
// One warn entry in the activity log per FINAL failure (a blip that a retry
// recovers is no longer logged — it wasn't a problem the owner needs to see).
function smtp_fail_log($toName, $error)
{
    if (function_exists('log_activity')) {
        log_activity('system', 'email.fail', 'Email failed to send — ' . $toName, [
            'severity' => 'warn',
            'entity' => 'email',
            'meta' => ['detail' => mb_substr((string) $error, 0, 200)],
        ]);
    }
}

// Connect + greeting + EHLO + STARTTLS + AUTH. Returns ['ok'=>true,'fp'=>…]
// or ['ok'=>false,'error'=>…,'retryable'=>bool].
function smtp_open()
{
    $host = SMTP_HOST;
    $port = (int) SMTP_PORT;
    $secure = strtolower(SMTP_SECURE);
    $timeout = 15;

    // For SSL (port 465) we connect with an ssl:// wrapper; for TLS (587) we
    // connect plain then upgrade with STARTTLS.
    $transport = $secure === 'ssl' ? "ssl://{$host}" : $host;

    // Some shared hosts (incl. IONOS) present certs that don't perfectly match the
    // hostname; allow the connection rather than failing silently. Mail is still
    // encrypted — we just don't hard-verify the peer name.
    $ctx = stream_context_create([
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
            'allow_self_signed' => true,
        ],
    ]);

    $errno = 0;
    $errstr = '';
    $fp = @stream_socket_client("{$transport}:{$port}", $errno, $errstr, $timeout, STREAM_CLIENT_CONNECT, $ctx);
    if (!$fp) {
        return ['ok' => false, 'error' => "Connect failed: {$errstr} ({$errno})", 'retryable' => true];
    }
    stream_set_timeout($fp, $timeout);

    $fail = function ($msg, $reply = '') use ($fp) {
        smtp_quit($fp);
        $detail = trim(preg_replace('/\s+/', ' ', (string) $reply));
        return [
            'ok' => false,
            'error' => mb_substr($detail !== '' ? $msg . ' — ' . $detail : $msg, 0, 200),
            'retryable' => smtp_transient($reply),
        ];
    };

    $greet = smtp_read($fp);
    if (smtp_code($greet) !== 220) {
        return $fail('No 220 greeting', $greet);
    }

    $ehloHost = $_SERVER['SERVER_NAME'] ?? 'localhost';
    smtp_cmd($fp, "EHLO {$ehloHost}");
    $r = smtp_read($fp);
    if (smtp_code($r) !== 250) {
        return $fail('EHLO rejected', $r);
    }

    // Upgrade to TLS on 587
    if ($secure === 'tls') {
        smtp_cmd($fp, 'STARTTLS');
        $r = smtp_read($fp);
        if (smtp_code($r) !== 220) {
            return $fail('STARTTLS rejected', $r);
        }
        if (
            !@stream_socket_enable_crypto(
                $fp,
                true,
                STREAM_CRYPTO_METHOD_TLS_CLIENT |
                    STREAM_CRYPTO_METHOD_TLSv1_1_CLIENT |
                    STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT,
            )
        ) {
            smtp_quit($fp);
            return ['ok' => false, 'error' => 'TLS negotiation failed', 'retryable' => true];
        }
        smtp_cmd($fp, "EHLO {$ehloHost}");
        $r = smtp_read($fp);
        if (smtp_code($r) !== 250) {
            return $fail('EHLO after TLS rejected', $r);
        }
    }

    // AUTH LOGIN
    smtp_cmd($fp, 'AUTH LOGIN');
    $r = smtp_read($fp);
    if (smtp_code($r) !== 334) {
        return $fail('AUTH not accepted', $r);
    }
    smtp_cmd($fp, base64_encode(SMTP_USER));
    $r = smtp_read($fp);
    if (smtp_code($r) !== 334) {
        return $fail('Username rejected', $r);
    }
    smtp_cmd($fp, base64_encode(SMTP_PASS));
    $r = smtp_read($fp);
    if (smtp_code($r) !== 235) {
        return $fail('Login failed (check user/password)', $r);
    }

    return ['ok' => true, 'fp' => $fp];
}

// Send ONE message on an open, authenticated connection. Returns
// ['ok'=>bool,'error'=>…,'retryable'=>bool,'dirty'=>bool]. dirty=true means
// the connection is no longer trustworthy for another message (payload was
// transmitted but refused, or a read broke mid-exchange) — the caller must
// close it. A clean command rejection (MAIL/RCPT/DATA refused before any
// payload) is RSET so the same connection can carry the next message.
function smtp_transmit(
    $fp,
    $toEmail,
    $toName,
    $subject,
    $bodyText,
    $bodyHtml = null,
    $attachments = [],
    $replyTo = null,
    $messageId = null,
    $extraHeaders = [],
) {
    // Defence-in-depth: strip any CR/LF from the recipient so it can never inject
    // extra SMTP commands (RCPT TO) or email headers. Addresses are also validated
    // with FILTER_VALIDATE_EMAIL on input.
    $toEmail = preg_replace('/[\r\n]+/', '', (string) $toEmail);
    // The staging Test centre marks sample emails so they're unmistakable in the inbox.
    if (!empty($GLOBALS['__chb_test_prefix'])) {
        $subject = $GLOBALS['__chb_test_prefix'] . $subject;
    }

    // A pre-payload rejection: RSET so the connection stays usable for the
    // next message in a batch; if even RSET misbehaves, mark it dirty.
    $reject = function ($msg, $reply) use ($fp) {
        $detail = trim(preg_replace('/\s+/', ' ', (string) $reply));
        smtp_cmd($fp, 'RSET');
        $rst = smtp_read($fp);
        return [
            'ok' => false,
            'error' => mb_substr($detail !== '' ? $msg . ' — ' . $detail : $msg, 0, 200),
            'retryable' => smtp_transient($reply),
            'dirty' => smtp_code($rst) !== 250,
            // Pre-payload rejection: the message body never went out, so a
            // later retry (the outbox) can never double-send it.
            'sent_uncertain' => false,
        ];
    };

    // Envelope
    $from = MAIL_FROM;
    smtp_cmd($fp, "MAIL FROM:<{$from}>");
    $mfReply = smtp_read($fp);
    if (smtp_code($mfReply) !== 250) {
        return $reject('MAIL FROM rejected', $mfReply);
    }
    smtp_cmd($fp, "RCPT TO:<{$toEmail}>");
    $rcptReply = smtp_read($fp);
    $rc = smtp_code($rcptReply);
    if ($rc !== 250 && $rc !== 251) {
        return $reject('RCPT TO rejected', $rcptReply);
    }

    // Data
    smtp_cmd($fp, 'DATA');
    $dataReply = smtp_read($fp);
    if (smtp_code($dataReply) !== 354) {
        return $reject('DATA not accepted', $dataReply);
    }

    $fromName = defined('MAIL_FROM_NAME') ? MAIL_FROM_NAME : $from;
    $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    $fromDomain = substr(strrchr($from, '@') ?: '@localhost', 1);
    $headers = 'From: ' . mb_encode_safe($fromName) . " <{$from}>\r\n";
    $headers .= 'To: ' . mb_encode_safe($toName) . " <{$toEmail}>\r\n";
    // Reply-To: the caller can override (reply-by-email routes replies to an
    // inbound mailbox); CR/LF stripped so it can't inject headers.
    $rt = $replyTo && filter_var($replyTo, FILTER_VALIDATE_EMAIL) ? preg_replace('/[\r\n]+/', '', $replyTo) : $from;
    $headers .= "Reply-To: {$rt}\r\n";
    $headers .= "Subject: {$encSubject}\r\n";
    $headers .= "MIME-Version: 1.0\r\n";
    $headers .= 'Date: ' . date('r') . "\r\n";
    // Message-ID is required by many MTAs (incl. IONOS) — a message without one
    // can be rejected at the end of DATA ("Message not accepted"). A caller may
    // pass a token so a reply's In-Reply-To echoes it back to us.
    $mid =
        $messageId !== null && $messageId !== ''
            ? preg_replace('/[^A-Za-z0-9._+\-]/', '', (string) $messageId)
            : bin2hex(random_bytes(12));
    $headers .= "Message-ID: <{$mid}@{$fromDomain}>\r\n";
    // Marks mail this site wrote, so the mailbox can tell it from mail a person
    // sent from the same address (mailbox_is_site_sent).
    $headers .= "X-CHB-Origin: site\r\n";
    // Caller-supplied extra headers (e.g. List-Unsubscribe on marketing sends).
    // Names/values sanitised so they can never inject additional headers.
    foreach ((array) $extraHeaders as $hn => $hv) {
        $hn = preg_replace('/[^A-Za-z0-9\-]/', '', (string) $hn);
        $hv = trim(preg_replace('/[\r\n]+/', ' ', (string) $hv));
        if ($hn !== '' && $hv !== '') {
            $headers .= "{$hn}: {$hv}\r\n";
        }
    }

    // Base64-encode bodies in 76-char lines. This guarantees no line ever exceeds
    // the SMTP limit (which caused "501 line too long" with raw 8-bit HTML), and
    // safely carries UTF-8. chunk_split adds CRLF every 76 chars.
    $b64 = function ($s) {
        return rtrim(chunk_split(base64_encode($s), 76, "\r\n"), "\r\n");
    };

    // Build the body (multipart/alternative for text+html). If attachments are
    // present, wrap the whole thing in a multipart/mixed envelope.
    $altBoundary = 'chbalt_' . bin2hex(random_bytes(8));
    if ($bodyHtml !== null && $bodyHtml !== '') {
        $body =
            "--{$altBoundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" .
            $b64($bodyText) .
            "\r\n\r\n";
        $body .=
            "--{$altBoundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n" .
            $b64($bodyHtml) .
            "\r\n\r\n";
        $body .= "--{$altBoundary}--";
        $bodyType = "multipart/alternative; boundary=\"{$altBoundary}\"";
    } else {
        $body = $b64($bodyText);
        $bodyType = "text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64";
    }

    if (is_array($attachments) && count($attachments)) {
        $mix = 'chbmix_' . bin2hex(random_bytes(8));
        $headers .= "Content-Type: multipart/mixed; boundary=\"{$mix}\"\r\n";
        $msg = "--{$mix}\r\nContent-Type: {$bodyType}\r\n\r\n{$body}\r\n\r\n";
        foreach ($attachments as $att) {
            $fn = preg_replace('/[^A-Za-z0-9._-]/', '_', (string) ($att['filename'] ?? 'attachment'));
            $mime = $att['mime'] ?? 'application/octet-stream';
            $msg .= "--{$mix}\r\nContent-Type: {$mime}; name=\"{$fn}\"\r\n";
            $msg .= "Content-Transfer-Encoding: base64\r\n";
            $msg .= "Content-Disposition: attachment; filename=\"{$fn}\"\r\n\r\n";
            $msg .= $b64((string) ($att['content'] ?? '')) . "\r\n\r\n";
        }
        $msg .= "--{$mix}--";
        $payload = $headers . "\r\n" . $msg . "\r\n.";
    } else {
        $headers .= "Content-Type: {$bodyType}\r\n";
        $payload = $headers . "\r\n" . $body . "\r\n.";
    }

    smtp_cmd($fp, $payload);
    $finalReply = smtp_read($fp);
    if (smtp_code($finalReply) !== 250) {
        // The payload was transmitted: the server MAY have accepted it despite
        // the error, so this is NEVER retryable (a retry could double-send),
        // and the connection state is unknown — callers must close it.
        return [
            'ok' => false,
            'error' => mb_substr('Message not accepted: ' . trim($finalReply), 0, 200),
            'retryable' => false,
            'dirty' => true,
            // The payload WAS transmitted — the server may have accepted it
            // despite the error, so no layer above (outbox included) may ever
            // retry this message.
            'sent_uncertain' => true,
        ];
    }

    return ['ok' => true, 'error' => '', 'retryable' => false, 'dirty' => false, 'sent_uncertain' => false];
}

/**
 * Low-level: send one email via SMTP. Returns [ok=>bool, error=>string].
 * Retries ONCE on a transient failure (connect trouble or a 4xx before the
 * payload went out) — never after the payload was transmitted.
 */
function smtp_send(
    $toEmail,
    $toName,
    $subject,
    $bodyText,
    $bodyHtml = null,
    $attachments = [],
    $replyTo = null,
    $messageId = null,
    $extraHeaders = [],
) {
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) {
        return ['ok' => false, 'error' => 'Mail disabled'];
    }
    // Preview mode: capture the fully-built message instead of sending it, so the
    // back office can show the owner exactly what a templated email looks like
    // (booking confirmation, arrival info, payment request) — no send, no SMTP.
    if (isset($GLOBALS['__mail_preview']) && is_array($GLOBALS['__mail_preview'])) {
        $GLOBALS['__mail_preview'][] = [
            'to' => (string) $toEmail,
            'name' => (string) $toName,
            'subject' => (string) $subject,
            'text' => (string) $bodyText,
            'html' => $bodyHtml !== null ? (string) $bodyHtml : '',
        ];
        return ['ok' => true, 'preview' => true];
    }

    $last = ['ok' => false, 'error' => 'send failed'];
    for ($attempt = 1; $attempt <= 2; $attempt++) {
        $open = smtp_open();
        if (!$open['ok']) {
            $last = $open;
            if ($attempt === 1 && !empty($open['retryable'])) {
                usleep(800000); // brief pause — greylists/blips often clear immediately
                continue;
            }
            break;
        }
        $res = smtp_transmit($fp = $open['fp'], $toEmail, $toName, $subject, $bodyText, $bodyHtml, $attachments, $replyTo, $messageId, $extraHeaders);
        smtp_quit($fp);
        if ($res['ok']) {
            mail_sent_tally(1);
            email_outbox_kick(); // a proven-working link is the moment to retry queued mail
            return ['ok' => true, 'error' => ''];
        }
        $last = $res;
        if ($attempt === 1 && !empty($res['retryable'])) {
            usleep(800000);
            continue;
        }
        break;
    }
    smtp_fail_log($toName, $last['error'] ?? 'send failed');
    return [
        'ok' => false,
        'error' => $last['error'] ?? 'send failed',
        'sent_uncertain' => !empty($last['sent_uncertain']),
    ];
}

/**
 * Send SEVERAL messages over ONE connection (owner copies, newsletter, cron
 * batches) instead of a full connect+TLS+AUTH handshake per message. Each
 * message: ['to','name','subject','text','html','attachments','reply_to',
 * 'message_id','headers']. Returns one [ok,error] result per message, in
 * order. If the connection turns dirty mid-batch it reconnects once and
 * carries on; per-message failures don't stop the rest.
 */
function smtp_send_batch($messages)
{
    $results = [];
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) {
        foreach ($messages as $i => $m) {
            $results[$i] = ['ok' => false, 'error' => 'Mail disabled'];
        }
        return $results;
    }
    if (isset($GLOBALS['__mail_preview']) && is_array($GLOBALS['__mail_preview'])) {
        foreach ($messages as $i => $m) {
            $GLOBALS['__mail_preview'][] = [
                'to' => (string) ($m['to'] ?? ''),
                'name' => (string) ($m['name'] ?? ''),
                'subject' => (string) ($m['subject'] ?? ''),
                'text' => (string) ($m['text'] ?? ''),
                'html' => isset($m['html']) && $m['html'] !== null ? (string) $m['html'] : '',
            ];
            $results[$i] = ['ok' => true, 'preview' => true];
        }
        return $results;
    }

    $fp = null;
    $reconnects = 1; // allow one mid-batch reconnect (greylist blip, dropped socket)
    foreach ($messages as $i => $m) {
        if ($fp === null) {
            $open = smtp_open();
            if (!$open['ok'] && $reconnects > 0 && !empty($open['retryable'])) {
                $reconnects--;
                usleep(800000);
                $open = smtp_open();
            }
            if (!$open['ok']) {
                // Connection unavailable — fail this and every remaining message.
                for ($j = $i; $j < count($messages); $j++) {
                    if (!isset($results[$j])) {
                        $results[$j] = ['ok' => false, 'error' => $open['error']];
                        smtp_fail_log($messages[$j]['name'] ?? '', $open['error']);
                    }
                }
                return $results;
            }
            $fp = $open['fp'];
        }
        $res = smtp_transmit(
            $fp,
            $m['to'] ?? '',
            $m['name'] ?? '',
            $m['subject'] ?? '',
            $m['text'] ?? '',
            $m['html'] ?? null,
            $m['attachments'] ?? [],
            $m['reply_to'] ?? null,
            $m['message_id'] ?? null,
            $m['headers'] ?? [],
        );
        $results[$i] = ['ok' => $res['ok'], 'error' => $res['error'], 'sent_uncertain' => !empty($res['sent_uncertain'])];
        if (!$res['ok']) {
            smtp_fail_log($m['name'] ?? '', $res['error']);
        }
        if (!empty($res['dirty'])) {
            smtp_quit($fp);
            $fp = null; // next message reopens (bounded by $reconnects)
        }
    }
    if ($fp !== null) {
        smtp_quit($fp);
    }
    mail_sent_tally(count(array_filter($results, fn($r) => !empty($r['ok']))));
    return $results;
}

// Status → Email's seven-day trace: emails that actually left, counted per day
// in the internal key 'mail-sent-days' (14 days kept). Best-effort — a counter
// must never cost a send, so every failure is swallowed.
function mail_sent_tally($n)
{
    if ($n < 1 || !function_exists('content_json') || !function_exists('content_set_scalar')) {
        return;
    }
    try {
        // Locked: two sends finishing together would each add to the same read.
        content_locked('mail-sent-days', function () use ($n) {
            $m = content_json('mail-sent-days', []);
            $m = is_array($m) ? $m : [];
            $d = date('Y-m-d');
            $m[$d] = (int) ($m[$d] ?? 0) + (int) $n;
            ksort($m);
            $m = array_slice($m, -14, null, true);
            content_set_scalar('mail-sent-days', $m);
        });
    } catch (\Throwable $e) {
    }
}

// ---- WHO GETS AN EMAIL TO THE BACK OFFICE ----
// Each person chooses which kinds reach them (people-lib.php PEOPLE_MAILS: an
// area switched off takes its emails with it), and the extra addresses on
// Notifications are copied on every kind but the backup. Before people existed —
// or whenever the people can't be read — it is the config owner address plus
// those extras, exactly as it always was. A kind that must reach someone and that
// nobody has chosen falls back to the first owner, so an enquiry can't vanish.
// Returns [['to' => email, 'row' => person row|null], …], people first, deduped.
// $kind '' = the people with full access (any sender not yet given a kind).
function people_mail_recipients($kind)
{
    $only = people_mail_only();
    if ($only !== '') {
        return [['to' => $only, 'row' => function_exists('admin_me') ? admin_me() : null]];
    }
    $out = [];
    $seen = [];
    $add = function ($to, $row) use (&$out, &$seen) {
        $to = strtolower(trim((string) $to));
        if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL) || isset($seen[$to])) {
            return;
        }
        $seen[$to] = true;
        $out[] = ['to' => $to, 'row' => $row];
    };
    $people = people_mail_rows();
    if ($people === null) {
        if (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL) {
            $add(OWNER_NOTIFY_EMAIL, null);
        }
    } else {
        foreach ($people as $row) {
            $wants = $kind === '' ? people_is_full($row) && empty($row['invited_at']) : people_mail_gets($row, $kind);
            if ($wants) {
                $add(admin_contact_email($row), $row);
            }
        }
        if (!$out && ($kind === '' || (PEOPLE_MAILS[$kind]['must'] ?? '') !== '')) {
            $first = null;
            foreach ($people as $row) {
                if ((int) $row['id'] === admin_original_owner_id()) {
                    $first = $row;
                }
            }
            $add($first ? admin_contact_email($first) : (defined('OWNER_NOTIFY_EMAIL') ? OWNER_NOTIFY_EMAIL : ''), $first);
            if (!$out && defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL) {
                $add(OWNER_NOTIFY_EMAIL, null);
            }
        }
    }
    if ($kind !== 'backup') {
        foreach (people_mail_extras() as $e) {
            $add($e, null);
        }
    }
    return $out;
}
// The people who can sign in (not removed), or null before the people migration
// or when the table can't be read — the caller then does what it always did.
function people_mail_rows()
{
    if (!function_exists('db') || !function_exists('people_mail_gets') || !function_exists('admin_contact_email')) {
        return null;
    }
    try {
        return db()->query('SELECT * FROM admins WHERE removed_at IS NULL ORDER BY id')->fetchAll();
    } catch (\Throwable $e) {
        return null;
    }
}
// The extra addresses on Notifications ('notify-emails', a JSON array — so it
// MUST be read with content_json(): content_value() returns '' for an array,
// which would silently drop every extra recipient).
function people_mail_extras()
{
    $out = [];
    if (function_exists('content_json')) {
        try {
            foreach (content_json('notify-emails', []) as $e) {
                $e = trim((string) $e);
                if ($e !== '' && filter_var($e, FILTER_VALIDATE_EMAIL)) {
                    $out[] = $e;
                }
            }
        } catch (\Throwable $e) {
        }
    }
    return $out;
}
// Send THIS request's back-office emails to one address only (a sample, or a
// weekly email asked for from the back office): get with no argument.
function people_mail_only($addr = null)
{
    static $only = '';
    if ($addr !== null) {
        $only = strtolower(trim((string) $addr));
    }
    return $only;
}
// Who may reply to a guest by email (inbound-mail.php, mailbox-read.php): anyone
// with a sign-in, the config owner address and the extras. The thread token is
// the real gate; this list is defence in depth.
function people_mail_senders()
{
    $out = [];
    foreach (people_mail_rows() ?? [] as $row) {
        if (empty($row['invited_at'])) {
            $out[] = strtolower(admin_contact_email($row));
        }
    }
    if (defined('OWNER_NOTIFY_EMAIL') && OWNER_NOTIFY_EMAIL) {
        $out[] = strtolower((string) OWNER_NOTIFY_EMAIL);
    }
    foreach (people_mail_extras() as $e) {
        $out[] = strtolower($e);
    }
    return array_values(array_unique(array_filter($out)));
}
// The person a reply-by-email came from (their row), or null for an address that
// isn't anyone's sign-in (the config owner address, an extra): that reply is the
// owner's, as it always was.
function people_mail_sender_row($addr)
{
    $addr = strtolower(trim((string) $addr));
    foreach (people_mail_rows() ?? [] as $row) {
        if ($addr !== '' && empty($row['invited_at']) && strtolower(admin_contact_email($row)) === $addr) {
            return $row;
        }
    }
    return null;
}
// The addresses for a kind ('' = the people with full access), for callers that
// only need to know whether anyone would get it.
function owner_recipients($kind = '')
{
    return array_map(fn($r) => $r['to'], people_mail_recipients($kind));
}

/**
 * WARNING AND ALERT AS TEXT. The digest's needs-attention rows once set the status amber
 * and red straight into 13px `color:` — **1.73:1** for the amber and 2.99 for the red, on
 * the one email that exists to tell the owner something has gone wrong. Same ink-vs-fill
 * split the screens and email_accent_ink make: `#ffb74d` and `#e57373` are fine as FILLS
 * (a chip, a rule), illegible as WORDS. These are the back office's light --warn-text and
 * --danger-text, measured on card / well / outer ground: 5.61 / 5.22 / 5.11 and
 * 5.95 / 5.54 / 5.41:1 — a shade past AA rather than on it.
 */
function email_warn_ink()
{
    return '#9C5300'; // the dashboard's light --warn-text
}
function email_alert_ink()
{
    return '#BC2626'; // the dashboard's light --danger-text
}
// Branded HTML for plain-text owner alerts — the same shell and parts as every guest
// email, built automatically so every send_owner(subject, text) caller (new payment,
// new message, new review…) matches the rest. Blank lines split paragraphs; bare URLs
// become links; all escaped.
function owner_alert_text_html($subject, $text)
{
    // The shell already carries the brand — don't repeat it in the heading.
    $heading = preg_replace('/\s*[—–-]\s*Cottage Holidays Blakeney\s*$/u', '', (string) $subject);
    // A SUBJECT IS NOT A TITLE. "Payment received: £452.12 — Jollyboat — £301.27 still
    // to collect" wrapped to three lines at 24px. A subject of three or more parts
    // keeps its first part as the title and says the rest as the line under it.
    $parts = preg_split('/\s+[—–]\s+/u', $heading);
    $title = $heading;
    $lead = '';
    if (count($parts) >= 3) {
        $title = array_shift($parts);
        $lead = implode(' · ', $parts);
    }
    $inner = email_h($title) . ($lead !== '' ? email_lead(email_esc($lead)) : '');
    $link = function ($safe) {
        return preg_replace(
            '~(https?://[^\s<]+)~',
            '<a href="$1" style="color:' . email_accent_ink() . ';text-decoration:none;font-weight:600;">$1</a>',
            $safe,
        );
    };
    $paras = array_values(array_filter(array_map('trim', preg_split('/\n{2,}/', trim((string) $text))), fn($p) => $p !== ''));
    $lastPara = count($paras) - 1;
    foreach ($paras as $pi => $para) {
        // THE ALERT ENDS WHERE THE OWNER ACTS. owner_open_line()'s paragraph is the
        // record's own deep link: plain text in the text half, the one button here.
        // Only OUR link, and only as the last paragraph: a guest's message reading
        // "Open in the back office: https://…" became the house button pointing
        // wherever they liked (reproduced through the anonymous chat).
        if ($pi === $lastPara && owner_open_url_ok($para)) {
            $inner .= email_btn(substr($para, strlen('Open in the back office: ')), 'Open in the back office');
            continue;
        }
        // "Guest: Sarah / Amount: £452.12" IS A LIST OF FACTS — it renders as the
        // dashboard's label/value rows, not as lines of prose with colons in them.
        $lines = preg_split('/\n/', $para);
        $rows = [];
        foreach ($lines as $ln) {
            if (preg_match('/^([A-Z][A-Za-z &\/()]{1,28}):\s+(\S.*)$/u', trim($ln), $m)) {
                $rows[] = [email_esc($m[1]), $link(email_esc($m[2]))];
            } else {
                $rows = null;
                break;
            }
        }
        if ($rows) {
            $inner .= email_rows($rows);
            continue;
        }
        $inner .= email_p($link(nl2br(email_esc($para))));
    }
    return email_shell($heading, $inner);
}
// ============================================================
// The email OUTBOX — durable retry for one-shot transactional emails.
// The stamp-on-success crons (pre-arrival, review ask, waitlist, payment
// chasers) already self-heal: a failed send re-enters their due window on the
// next pass. The ONE-SHOT emails did not — a transport blip lost the booking
// confirmation, the enquiry acknowledgement, the owner's new-enquiry alert and
// any failed newsletter recipient, forever, with only an activity warn to show
// for it. The outbox is that missing half, as ONE pattern instead of four
// postures. Two rules carry all of its safety:
//   • A message is queued ONLY when the payload provably never went out
//     (email_queueable — sent_uncertain rows are never retried by any layer).
//   • A flow with its own stamp-on-success retry must NEVER also queue here —
//     two retry mechanisms for one email is a double send. test-payrail scans
//     those files for smtp_send_reliable and fails if one adopts it.
// Decisions are PURE (email_queueable / email_outbox_backoff /
// email_outbox_step) so test-payrail drives them with no database; the IO
// wrappers stay thin and never throw into the caller's failure path.
// ============================================================

// May this failed smtp_send result be retried later? False when the payload
// may have been accepted (a retry could double-send), and false for 'Mail
// disabled' (retrying can never succeed, and every dev/CI send would queue).
function email_queueable($res)
{
    if (!is_array($res) || !empty($res['ok'])) {
        return false;
    }
    if (!empty($res['sent_uncertain'])) {
        return false;
    }
    // A PERMANENT refusal (a 5xx: "no such mailbox", a malformed address) will be
    // refused again on every retry. Queued, each one retried for 48 hours and sat in
    // the outbox's pending cap, ahead of the next booking confirmation.
    if (array_key_exists('retryable', $res) && $res['retryable'] === false) {
        return false;
    }
    return ($res['error'] ?? '') !== 'Mail disabled';
}

// Retry curve in MINUTES: 10, 20, 40, 80, 160, 320, then capped at 360 — quick
// enough that a greylist clears same-morning, slow enough not to hammer a
// genuinely down relay.
function email_outbox_backoff($tries)
{
    return (int) min(360, 10 * pow(2, max(0, (int) $tries)));
}

// The row transition after one drain attempt — pure, so the give-up boundary
// is testable in both directions. Gives up after 8 tries or 48 hours: an email
// two days late is no longer the email it was, and the give-up is LOUD (the
// drain logs a warn into Needs attention).
function email_outbox_step($row, $ok, $nowTs)
{
    if ($ok) {
        return ['outcome' => 'sent'];
    }
    $tries = (int) ($row['tries'] ?? 0) + 1;
    $createdTs = strtotime((string) ($row['created_at'] ?? '')) ?: $nowTs;
    if ($tries >= 8 || $nowTs - $createdTs >= 48 * 3600) {
        return ['outcome' => 'gaveup', 'tries' => $tries];
    }
    return [
        'outcome' => 'retry',
        'tries' => $tries,
        'next_try_at' => date('Y-m-d H:i:s', $nowTs + email_outbox_backoff($tries) * 60),
    ];
}

// Queue one message (smtp_send argument shape). Never throws — this runs on a
// path that is already failing, and losing the queue insert must not turn a
// lost email into a broken endpoint. Capped so a relay that stays down cannot
// grow the table without bound.
function email_outbox_add($ctx, $toEmail, $toName, $subject, $text, $html, $attachments = [], $replyTo = null, $messageId = null, $extraHeaders = [], $lastError = '')
{
    // An oversized attachment (the weekly DB backup rides send_owner) is not
    // worth queueing: base64 in a table row, for an email whose next weekly run
    // regenerates it anyway. The message queues only when its attachments fit.
    $attBytes = 0;
    foreach (is_array($attachments) ? $attachments : [] as $a) {
        $attBytes += strlen((string) ($a['content'] ?? ''));
    }
    if ($attBytes > 512 * 1024) {
        return false;
    }
    try {
        $pending = (int) db()
            ->query('SELECT COUNT(*) FROM email_outbox WHERE sent_at IS NULL AND gave_up_at IS NULL')
            ->fetchColumn();
        if ($pending >= 500) {
            smtp_fail_log($toName, 'outbox full — ' . $ctx . ' not queued');
            return false;
        }
        db()
            ->prepare(
                'INSERT INTO email_outbox (next_try_at, context, to_email, to_name, subject, body_text, body_html, reply_to, message_id, extra_headers, attachments, last_error)
                 VALUES (DATE_ADD(NOW(), INTERVAL 10 MINUTE), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            )
            ->execute([
                mb_substr((string) $ctx, 0, 40),
                mb_substr((string) $toEmail, 0, 190),
                mb_substr((string) $toName, 0, 190),
                mb_substr((string) $subject, 0, 300),
                (string) $text,
                $html !== null ? (string) $html : null,
                $replyTo !== null && $replyTo !== '' ? mb_substr((string) $replyTo, 0, 190) : null,
                $messageId !== null && $messageId !== '' ? mb_substr((string) $messageId, 0, 120) : null,
                $extraHeaders ? json_encode($extraHeaders) : null,
                // System one-shots carry at most a ~1KB ICS; the manual composer
                // (multi-MB attachments) is deliberately never queued.
                $attachments ? json_encode(array_map(fn($a) => [
                    'filename' => (string) ($a['filename'] ?? 'attachment'),
                    'mime' => (string) ($a['mime'] ?? 'application/octet-stream'),
                    'content_b64' => base64_encode((string) ($a['content'] ?? '')),
                ], $attachments)) : null,
                mb_substr((string) $lastError, 0, 220),
            ]);
        return true;
    } catch (\Throwable $e) {
        // Un-migrated table / DB trouble: the send already failed and was
        // warn-logged; the queue is best-effort on top.
        return false;
    }
}

// smtp_send + queue-on-failure. For ONE-SHOT emails only — see the module
// header for the double-retry rule. Returns smtp_send's shape plus
// 'queued' => true when the message is in the outbox.
function smtp_send_reliable($ctx, $toEmail, $toName, $subject, $bodyText, $bodyHtml = null, $attachments = [], $replyTo = null, $messageId = null, $extraHeaders = [])
{
    $res = smtp_send($toEmail, $toName, $subject, $bodyText, $bodyHtml, $attachments, $replyTo, $messageId, $extraHeaders);
    if (!empty($res['ok']) || !email_queueable($res)) {
        return $res;
    }
    $queued = email_outbox_add($ctx, $toEmail, $toName, $subject, $bodyText, $bodyHtml, $attachments, $replyTo, $messageId, $extraHeaders, $res['error'] ?? '');
    if ($queued) {
        $res['queued'] = true;
    }
    return $res;
}

// Retry due rows, oldest first. Runs from self-repair daily and from
// email_outbox_kick after any successful send (a proven-working link is the
// only real evidence the relay is back). Re-entrancy-guarded: the drain's own
// sends go through smtp_send, whose success hook calls the kick.
function email_outbox_drain($max = 10)
{
    static $draining = false;
    if ($draining) {
        return ['sent' => 0, 'retried' => 0, 'gaveup' => 0];
    }
    $draining = true;
    $out = ['sent' => 0, 'retried' => 0, 'gaveup' => 0];
    try {
        $rows = db()
            ->prepare('SELECT * FROM email_outbox WHERE sent_at IS NULL AND gave_up_at IS NULL AND next_try_at <= NOW() ORDER BY id LIMIT ' . max(1, (int) $max));
        $rows->execute();
        foreach ($rows->fetchAll() as $row) {
            // CLAIM THE ROW BEFORE SENDING. The static $draining flag above is
            // per-process; the kick fires from ordinary traffic at exactly the
            // moment the relay recovers, which is exactly when self-repair's
            // daily drain is walking the same backlog — two processes SELECTing
            // the same un-stamped row both sent it (a guest holding two booking
            // confirmations). Pushing next_try_at forward under the SELECT's own
            // conditions is the arbitration: rowCount 1 owns the row, 0 means
            // another process got there first. A process that dies mid-send
            // leaves the row to retry when the pushed next_try_at arrives —
            // at-least-once is kept, concurrent double-delivery is not.
            $claim = db()->prepare(
                'UPDATE email_outbox SET next_try_at = DATE_ADD(NOW(), INTERVAL 10 MINUTE)
                 WHERE id = ? AND sent_at IS NULL AND gave_up_at IS NULL AND next_try_at <= NOW()',
            );
            $claim->execute([(int) $row['id']]);
            if ($claim->rowCount() !== 1) {
                continue; // claimed by a concurrent drain
            }
            $atts = [];
            if (!empty($row['attachments'])) {
                $parsed = json_decode((string) $row['attachments'], true);
                foreach (is_array($parsed) ? $parsed : [] as $a) {
                    $bin = base64_decode((string) ($a['content_b64'] ?? ''), true);
                    if ($bin !== false && $bin !== '') {
                        $atts[] = ['filename' => (string) ($a['filename'] ?? 'attachment'), 'mime' => (string) ($a['mime'] ?? 'application/octet-stream'), 'content' => $bin];
                    }
                }
            }
            $hdrs = [];
            if (!empty($row['extra_headers'])) {
                $parsed = json_decode((string) $row['extra_headers'], true);
                if (is_array($parsed)) {
                    $hdrs = $parsed;
                }
            }
            $res = smtp_send(
                (string) $row['to_email'],
                (string) $row['to_name'],
                (string) $row['subject'],
                (string) ($row['body_text'] ?? ''),
                $row['body_html'] !== null && $row['body_html'] !== '' ? (string) $row['body_html'] : null,
                $atts,
                $row['reply_to'] !== null && $row['reply_to'] !== '' ? (string) $row['reply_to'] : null,
                $row['message_id'] !== null && $row['message_id'] !== '' ? (string) $row['message_id'] : null,
                $hdrs,
            );
            // A retry that itself ends sent_uncertain is TERMINAL: the payload
            // went out, so this row may never be tried again either way.
            $step = email_outbox_step($row, !empty($res['ok']), time());
            if (!empty($res['sent_uncertain'])) {
                $step = ['outcome' => 'gaveup', 'tries' => (int) $row['tries'] + 1];
            }
            if ($step['outcome'] === 'sent') {
                db()->prepare('UPDATE email_outbox SET sent_at = NOW(), tries = tries + 1 WHERE id = ?')->execute([(int) $row['id']]);
                $out['sent']++;
            } elseif ($step['outcome'] === 'gaveup') {
                db()->prepare('UPDATE email_outbox SET gave_up_at = NOW(), tries = ?, last_error = ? WHERE id = ?')
                    ->execute([$step['tries'], mb_substr((string) ($res['error'] ?? ''), 0, 220), (int) $row['id']]);
                if (function_exists('log_activity')) {
                    log_activity('system', 'email.gaveup', 'Email given up after retries — ' . $row['context'] . ' to ' . $row['to_name'], [
                        'severity' => 'warn',
                        'entity' => 'email',
                        'meta' => ['detail' => mb_substr((string) ($res['error'] ?? ''), 0, 200)],
                    ]);
                }
                $out['gaveup']++;
            } else {
                db()->prepare('UPDATE email_outbox SET tries = ?, next_try_at = ?, last_error = ? WHERE id = ?')
                    ->execute([$step['tries'], $step['next_try_at'], mb_substr((string) ($res['error'] ?? ''), 0, 220), (int) $row['id']]);
                $out['retried']++;
                // The relay is still refusing — stop burning the batch on it.
                break;
            }
        }
    } catch (\Throwable $e) {
        // Un-migrated table or DB trouble — the daily pass will try again.
    }
    $draining = false;
    return $out;
}

// Cheap post-success probe: drain a few due rows while the link is provably
// up. Swallows everything — a queued retry must never break a live send path.
function email_outbox_kick()
{
    static $kicked = false;
    if ($kicked || !function_exists('db')) {
        return;
    }
    $kicked = true; // once per request — the daily drain covers the rest
    try {
        email_outbox_drain(3);
    } catch (\Throwable $e) {
    }
}

// Send one back-office email of one KIND (people-lib.php PEOPLE_MAILS) to everyone
// who gets it. $opts: attachments, reply_to, message_id, and compose — asked per
// recipient (their person row, or null for an extra address) for [subject, text,
// html], which is how a digest leaves the money out of a copy for someone without
// Money overview. Plain-text callers get the house shell automatically.
function send_people($kind, $subject, $text, $html = null, array $opts = [])
{
    $rcpts = people_mail_recipients((string) $kind);
    if (!$rcpts) {
        return ['ok' => false, 'error' => 'No owner email'];
    }
    $compose = isset($opts['compose']) && is_callable($opts['compose']) ? $opts['compose'] : null;
    // One connection for all the copies (was one full handshake per address).
    $msgs = [];
    foreach ($rcpts as $r) {
        [$s, $t, $h] = $compose ? $compose($r['row']) : [$subject, $text, $html];
        $msgs[] = [
            'to' => $r['to'],
            'name' => $r['row'] && function_exists('people_display_name') ? people_display_name($r['row']) : 'Owner',
            'subject' => $s,
            'text' => $t,
            'html' => $h === null || $h === '' ? owner_alert_text_html($s, $t) : $h,
            'attachments' => $opts['attachments'] ?? [],
            'reply_to' => $opts['reply_to'] ?? null,
            'message_id' => $opts['message_id'] ?? null,
        ];
    }
    $results = smtp_send_batch($msgs);
    // Owner alerts are one-shots with no stamp-on-success pass behind them —
    // queue each failed copy so "Payment received" survives a relay blip.
    $firstQueued = false;
    foreach ($results as $i => $r) {
        if (empty($r['ok']) && email_queueable($r) && isset($msgs[$i])) {
            email_outbox_add('owner-alert', $msgs[$i]['to'], $msgs[$i]['name'], $msgs[$i]['subject'], $msgs[$i]['text'], $msgs[$i]['html'], $msgs[$i]['attachments'] ?? [], $msgs[$i]['reply_to'] ?? null, $msgs[$i]['message_id'] ?? null, [], $r['error'] ?? '');
            if ($i === 0) {
                $firstQueued = true;
            }
        }
    }
    // Report whether the first copy was queued, so a caller that stamps a
    // once-per-day key (the weekly digests) can stamp on delivered-OR-queued and
    // not resend the same day: a failed morning send that queued would otherwise
    // be resent by a same-day cron/deploy ping and then also drained — two copies.
    $out = $results[0] ?? ['ok' => false, 'error' => 'No owner email'];
    if ($firstQueued) {
        $out['queued'] = true;
    }
    return $out;
}
// A sender with no kind yet: the people with full access (and the extras).
function send_owner($subject, $text, $html = null, $atts = [], $replyTo = null, $messageId = null)
{
    return send_people('', $subject, $text, $html, ['attachments' => $atts, 'reply_to' => $replyTo, 'message_id' => $messageId]);
}

/** Encode a display name safely for a header (handles non-ASCII). */
function mb_encode_safe($name)
{
    $name = trim((string) preg_replace('/[\r\n\t]+/', ' ', (string) $name));
    if (preg_match('/[^\x20-\x7E]/', $name)) {
        return '=?UTF-8?B?' . base64_encode($name) . '?=';
    }
    // A name with RFC 5322's specials goes in quotes, or its comma starts a second
    // recipient: an enquiry named "Bob,<someone@else>" put a stranger on reply-all,
    // and a plain "Smith, John" made every confirmation's To: header malformed.
    if (preg_match('/[()<>\[\]:;@\\\\,."]/', $name)) {
        return '"' . addcslashes($name, '"\\') . '"';
    }
    return $name;
}

/**
 * Send the guest confirmation + a separate owner notification for a booking.
 * $b is an associative array with keys: name, email, prop_name, check_in,
 * check_out, check_in_time, check_out_time, adults, children, total,
 * damages_deposit, ref. Returns [guest=>result, owner=>result].
 */
// Build an iCalendar (.ics) VEVENT for a booking so the guest can add it to
// their phone calendar. All-day-ish: uses the check-in/out dates with times.
function build_booking_ics($b)
{
    if (empty($b['check_in']) || empty($b['check_out'])) {
        return '';
    }
    // ?: not ?? — the columns are NOT NULL DEFAULT, so the value that actually
    // occurs when the form's time field is cleared is '' (never null), and
    // strtotime('2026-09-06 ') parses happily to MIDNIGHT: the guest's calendar
    // invite said the stay begins at 00:00. The email_time('') lesson, in the
    // attachment of the same email.
    $ciT = ($b['check_in_time'] ?? '') ?: '15:00';
    $coT = ($b['check_out_time'] ?? '') ?: '10:00';
    $ci = $b['check_in'] . ' ' . $ciT;
    $co = $b['check_out'] . ' ' . $coT;
    $fmt = function ($s) {
        $t = strtotime($s);
        return $t ? gmdate('Ymd\THis\Z', $t) : '';
    };
    $dtStart = $fmt($ci);
    $dtEnd = $fmt($co);
    if (!$dtStart || !$dtEnd) {
        return '';
    }
    $uid = 'chb-' . ($b['ref'] ?? bin2hex(random_bytes(6))) . '@cottageholidaysblakeney';
    $esc = function ($s) {
        return preg_replace('/([,;\\\\])/', '\\\\$1', str_replace("\n", '\\n', (string) $s));
    };
    $summary = $esc('Stay at ' . ($b['prop_name'] ?? 'your cottage'));
    $loc = $esc($b['address'] ?? '');
    $desc = $esc('Booking ref ' . ($b['ref'] ?? '') . '. Check-in from ' . $ciT . ', check-out by ' . $coT . '.');
    $lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Cottage Holidays Blakeney//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        'UID:' . $uid,
        'DTSTAMP:' . gmdate('Ymd\THis\Z'),
        'DTSTART:' . $dtStart,
        'DTEND:' . $dtEnd,
        'SUMMARY:' . $summary,
        $loc ? 'LOCATION:' . $loc : '',
        'DESCRIPTION:' . $desc,
        'END:VEVENT',
        'END:VCALENDAR',
    ];
    return implode("\r\n", array_filter($lines, fn($l) => $l !== ''));
}

// ── INK vs FILL ─────────────────────────────────────────────────────────────
// The screens' --accent / --accent-text split, applied to the inbox: the rose-gold is
// fine for a button, a rule or a dot (the 3:1 non-text bar) and fails AA as WORDS.
// Every ink is the back office's own light-mode token, measured on the three grounds
// it really sits on — card #FDFCFA / well #F4F4F2 / outer ground #F5F1E9:
//
//   email_muted_ink()  — --text-muted #52646E: every label and all secondary prose.
//     6.01 / 5.60 / 5.47:1.
//   email_accent_ink() — --accent-text #965C35: the accent as TEXT (a link, an accent
//     word). 5.28 / 4.92 / 4.81:1.
//
// A shade PAST the pass mark rather than on it, the discipline the screen tokens
// follow — 4.5 is the floor to clear, not to land on. test-emails-render §2 measures
// every rendered email in both themes, so the prose here cannot drift from what ships.
function email_muted_ink()
{
    return '#52646E';
}
function email_accent_ink()
{
    return '#965C35';
}
function email_sans()
{
    return "'Montserrat','Helvetica Neue',Arial,sans-serif";
}
function email_serif()
{
    return "'Playfair Display',Georgia,'Times New Roman',serif";
}
// A short, single-line excerpt for a SUBJECT: whitespace collapsed, square brackets
// dropped (a "[#token]" typed by a stranger must never read as a reply-routing tag) and
// cut on a word with an ellipsis. Plain text out; callers escape for HTML as usual.
function email_snip($s, $max = 60)
{
    $t = trim(preg_replace('/\s+/', ' ', str_replace(['[', ']'], '', (string) $s)));
    if (function_exists('mb_strlen') && mb_strlen($t) > $max) {
        $t = mb_substr($t, 0, $max);
        $t = rtrim(preg_replace('/\s+\S*$/u', '', $t) ?: $t, " ,.;:-") . '…';
    } elseif (!function_exists('mb_strlen') && strlen($t) > $max) {
        $t = rtrim(substr($t, 0, $max), " ,.;:-") . '…';
    }
    return $t;
}
function email_esc($s)
{
    return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
}

// ============================================================
//  Email design system — THE BACK OFFICE'S OWN. Every colour is a dashboard
//  token composited onto the ground it really sits on (an email cannot lean on
//  rgba), so an email in a dark inbox is the Today screen's charcoal, card and
//  rose-gold button, and a light one is the light theme's. One left rail, the
//  dashboard's type scale (12 / 13 / 15 / 17 / 28 / 34), three corners (the
//  card 20, everything inside it 12, buttons and capsules round). Table-based
//  and Outlook-safe (bgcolor fallbacks + VML buttons). Light palette:
//    ground #F5F1E9   card #FDFCFA (edge #E2E3E3)   hairline #E2E3E3
//    well #F4F4F2 (edge #EBEBEA)   heavy rule #C7CACA
//    ink #1B2A34   muted email_muted_ink()   accent #C6885E as FILL,
//    email_accent_ink() as TEXT   button ink #1B1208
//  Every ink and fill has a DARK twin — see email_dark_palette() below the
//  shell: the media block ships from it and the render gate measures it.
//  ONE SHAPE FOR EVERY EMAIL, top to bottom: brand line → the stay
//  (email_eyebrow) → title (email_h) → lead → the key block (email_amount /
//  email_code) → ONE button (email_btn) → a second choice (email_btn2) →
//  details (email_rows, states as email_cap) → small print → footer.
// ============================================================

// THE DASHBOARD'S ONE BUTTON — the Today card's "Return £50": a full-width pill,
// 48px tall, the accent with dark ink (6.23:1 light, 8.56:1 on the dark accent).
// Rounded in Outlook too, via VML. ONE colour for every email: the $accent a caller
// passes is accepted and ignored, because a cottage colour on a button carrying
// WORDS measured 3.30:1 on Jollyboat's green.
function email_btn($href, $label, $accent = '#C6885E', $textColor = '#1B1208')
{
    $accent = '#C6885E';
    $textColor = '#1B1208';
    $h = email_esc($href);
    $l = email_esc($label);
    $sans = email_sans();
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0 8px;"><tr><td align="center" bgcolor="' .
        $accent . '" style="border-radius:999px;">' .
        '<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="' . $h .
        '" style="height:48px;v-text-anchor:middle;width:520px;" arcsize="50%" stroke="f" fillcolor="' . $accent .
        '"><w:anchorlock/><center style="color:' . $textColor . ';font-family:' . $sans . ';font-size:15px;font-weight:bold;"><![endif]-->' .
        '<a href="' . $h . '" style="display:block;background:' . $accent . ';color:' . $textColor .
        ';text-decoration:none;font-family:' . $sans . ';font-size:15px;font-weight:600;line-height:48px;border-radius:999px;">' . $l . '</a>' .
        '<!--[if mso]></center></v:roundrect><![endif]--></td></tr></table>';
}

// THE KEY BLOCK — the one figure an email exists to state, in the dashboard's inset
// well: label above, the amount 34px tight and tabular, a line of context below. A code
// is its twin (email_code). The figure is always INK: whether money goes out or comes
// back is said by the label, not by a colour the reader has to decode — so $valueColor
// is accepted and ignored. $amount and $sub are pre-formatted; the label is escaped.
function email_amount($label, $amount, $sub = '', $valueColor = '#1B2A34')
{
    $sans = email_sans();
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>' .
        '<td bgcolor="#F4F4F2" style="background:#F4F4F2;border:1px solid #EBEBEA;border-radius:12px;padding:16px 20px 18px;">' .
        '<div style="font-family:' . $sans . ';font-size:13px;font-weight:600;color:' . email_muted_ink() . ';">' . email_esc($label) . '</div>' .
        '<div style="font-family:' . $sans . ';font-size:34px;font-weight:700;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;color:#1B2A34;padding:4px 0 2px;line-height:1.2;">' .
        $amount . '</div>' .
        ($sub !== '' ? '<div style="font-family:' . $sans . ';font-size:13px;line-height:1.6;color:' . email_muted_ink() . ';">' . $sub . '</div>' : '') .
        '</td></tr></table>';
}

// Label/value detail rows with hairline dividers. $rows = [[label, valueHtml], ...]
function email_rows($rows)
{
    $sans = email_sans();
    $out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;">';
    $n = count($rows);
    $i = 0;
    foreach ($rows as $r) {
        $i++;
        // The dashboard's label/value row: muted 13/600 label, ink 15/600 value on the
        // right rail, one hairline between rows.
        $bd = $i < $n ? 'border-bottom:1px solid #E2E3E3;' : '';
        $out .= '<tr><td style="padding:12px 12px 12px 0;' . $bd . 'font-family:' . $sans .
            ';font-size:13px;font-weight:600;color:' . email_muted_ink() . ';vertical-align:top;width:40%;line-height:1.5;">' . $r[0] . '</td>' .
            '<td align="right" style="padding:12px 0;' . $bd . 'font-family:' . $sans .
            ';font-size:15px;font-weight:600;color:#1B2A34;vertical-align:top;line-height:1.4;">' . $r[1] . '</td></tr>';
    }
    return $out . '</table>';
}

// THE ONE SHOUT AN EMAIL KEEPS — entry details, the ask — as the dashboard's tinted
// card: the accent at 9% with its own 24% edge, and no left rail (the dashboard retired
// those). A warning passes a warn colour as $accent and takes the warn tint, as the
// Today card does. Pass pre-escaped HTML.
function email_note($html, $accent = '#C6885E')
{
    $sans = email_sans();
    $warn = in_array(strtoupper((string) $accent), ['#FFA726', '#FFB74D', '#8A5000', '#9C5300'], true);
    $bg = $warn ? '#FDF1DE' : '#F8F2EC';
    $edge = $warn ? '#FDE8C7' : '#F0E0D5';
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>' .
        '<td bgcolor="' . $bg . '" style="background:' . $bg . ';border:1px solid ' . $edge . ';border-radius:12px;padding:14px 16px;font-family:' .
        $sans . ';font-size:15px;color:#1B2A34;line-height:1.6;">' . $html . '</td></tr></table>';
}

// THE TITLE IS THE DASHBOARD'S PAGE TITLE — "Today": 28px at regular weight, sentence
// case, saying what the email is for ("Pay your deposit", never just the cottage name).
// $accent is accepted and unused: the cottage is named by email_eyebrow's dot.
function email_h($text, $accent = '')
{
    return '<h1 style="font-family:' . email_sans() .
        ';font-size:28px;font-weight:400;letter-spacing:0;color:#1B2A34;margin:0 0 4px;line-height:1.25;">' .
        email_esc($text) . '</h1>';
}
// A CODE IS THE FIGURE'S TWIN: same well, same label/value/sub anatomy, the digits
// spaced in their two groups so they can be read off one screen and typed on another.
function email_code($label, $code, $sub = '')
{
    $sans = email_sans();
    $c = preg_replace('/\s+/', '', (string) $code);
    $pretty = strlen($c) === 6 ? substr($c, 0, 3) . '&#8201;&#8201;' . substr($c, 3) : email_esc($c);
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>' .
        '<td bgcolor="#F4F4F2" style="background:#F4F4F2;border:1px solid #EBEBEA;border-radius:12px;padding:16px 20px 18px;">' .
        '<div style="font-family:' . $sans . ';font-size:13px;font-weight:600;color:' . email_muted_ink() . ';">' . email_esc($label) . '</div>' .
        '<div style="font-family:' . $sans . ';font-size:34px;font-weight:700;letter-spacing:0.14em;font-variant-numeric:tabular-nums;color:#1B2A34;padding:4px 0 2px;line-height:1.2;">' .
        $pretty . '</div>' .
        ($sub !== '' ? '<div style="font-family:' . $sans . ';font-size:13px;line-height:1.6;color:' . email_muted_ink() . ';">' . $sub . '</div>' : '') .
        '</td></tr></table>';
}

// The line under a title — muted, body size. PRE-ESCAPED, like email_p.
function email_lead($html)
{
    return '<p style="font-family:' . email_sans() . ';font-size:15px;color:' . email_muted_ink() . ';line-height:1.6;margin:4px 0 0;">' . $html . '</p>';
}

// THE COTTAGE IS A DOT, NEVER A BAR. Its colour marks the stay the way the timeline's
// lane dot does — a fill, not words, so any cottage colour is safe — beside the name.
// $dot is the cottage accent; $text is PLAIN text (escaped here).
function email_eyebrow($dot, $text)
{
    return '<div style="font-family:' . email_sans() . ';font-size:13px;font-weight:600;color:' . email_muted_ink() . ';margin:0 0 8px;line-height:1.5;">' .
        '<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:' . email_esc($dot) . ';margin-right:8px;vertical-align:1px;"></span>' .
        email_esc($text) . '</div>';
}

// The dashboard's status capsule (.st-cap): 12/600, a pill tinted in its own tone.
function email_cap($tone, $text)
{
    $t = [
        'ok' => ['#E6F2E4', '#D3EAD1', '#29712D'],
        'warn' => ['#FDF1DE', '#FDE8C7', '#9C5300'],
        'bad' => ['#FAEAE8', '#F7DBDA', '#BC2626'],
        'info' => ['#E5ECEE', '#D1DFE4', '#316784'],
    ][$tone] ?? ['#E5ECEE', '#D1DFE4', '#316784'];
    return '<span style="display:inline-block;background:' . $t[0] . ';border:1px solid ' . $t[1] . ';color:' . $t[2] .
        ';font-family:' . email_sans() . ';font-size:12px;font-weight:600;line-height:1.4;padding:4px 12px;border-radius:999px;white-space:nowrap;">' .
        email_esc($text) . '</span>';
}

// A section caption — the dashboard's caption tier, sentence case.
function email_caption($text)
{
    return '<div style="font-family:' . email_sans() . ';font-size:13px;font-weight:600;color:' . email_muted_ink() . ';margin:24px 0 4px;">' .
        email_esc($text) . '</div>';
}


// Body paragraph (muted=secondary text). Pass pre-escaped HTML.
function email_p($html, $muted = false)
{
    return '<p style="font-family:' . email_sans() . ';font-size:15px;color:' .
        ($muted ? email_muted_ink() : '#1B2A34') . ';line-height:1.6;margin:12px 0 0;">' . $html . '</p>';
}

// ============================================================
//  DATES, TIMES AND PLACES A PERSON CAN ACT ON.
//  Every guest email used uk_date() (05/09/2026) and a raw 24-hour time. Two problems:
//  the weekday is the thing a traveller actually checks ("are we driving down on the
//  Saturday?"), and a numeric UK date reads as 9 May to anyone used to MM/DD — which for
//  a coastal holiday let is not a rare visitor. These are EMAIL-ONLY: the app's screens,
//  the ICS, the APIs and storage all keep their existing formats (uk_date / ISO), because
//  DD/MM/YYYY is the house form on screen and only prose wants a weekday.
// ============================================================
function email_date($iso, $withYear = true)
{
    $t = strtotime((string) $iso);
    if (!$t) {
        return (string) $iso;
    }
    return date('D j M', $t) . ($withYear ? date(' Y', $t) : '');
}
// "3pm", not "15:00" — and "10:30am" when there are minutes to say.
function email_time($hhmm)
{
    // AN ABSENT TIME IS NOT MIDNIGHT. strtotime('2000-01-01 ') parses fine and
    // yields 00:00, so an unset check-in time rendered "12am" — a stated fact,
    // wrong, on the line telling a guest when they can arrive. Empty in, empty out;
    // the caller decides what to print instead.
    $hhmm = trim((string) $hhmm);
    if ($hhmm === '') {
        return '';
    }
    $t = strtotime('2000-01-01 ' . $hhmm);
    if (!$t) {
        return (string) $hhmm;
    }
    return strtolower(date((int) date('i', $t) === 0 ? 'ga' : 'g:ia', $t));
}
// Works on iOS and Android without knowing which: Google's universal maps URL opens the
// native app where there is one and the web map where there isn't.
function email_maplink($addr)
{
    return 'https://www.google.com/maps/search/?api=1&query=' . rawurlencode((string) $addr);
}
// AN ADDRESS IS NOT A FIELD VALUE. Put one in email_rows()'s 40/60 grid and it wraps to
// three right-aligned underlined lines on a phone. Its own full-width block, plain text,
// with ONE link doing the work.
function email_address_block($addr)
{
    $addr = trim((string) $addr);
    if ($addr === '') {
        return '';
    }
    $sans = email_sans();
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;"><tr><td style="padding:12px 0;border-top:1px solid #E2E3E3;">' .
        '<div style="font-family:' . $sans . ';font-size:13px;font-weight:600;color:' . email_muted_ink() . ';padding-bottom:4px;">Address</div>' .
        '<div style="font-family:' . $sans . ';font-size:15px;font-weight:600;color:#1B2A34;line-height:1.5;">' . email_esc($addr) . '</div>' .
        '<div style="padding-top:8px;"><a href="' . email_esc(email_maplink($addr)) . '" style="font-family:' . $sans . ';font-size:13px;font-weight:600;color:' . email_accent_ink() . ';text-decoration:none;">Open in Maps &rsaquo;</a></div>' .
        '</td></tr></table>';
}
// A SECOND CHOICE WITHOUT A SECOND SHOUT — the dashboard's .bhub-next-alt: the same
// pill as email_btn, outlined and in ink, so an email can carry "pay" and "view"
// without two competing calls to action.
function email_btn2($href, $label)
{
    $sans = email_sans();
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 4px;"><tr>' .
        '<td align="center" bgcolor="#FDFCFA" style="background:#FDFCFA;border-radius:999px;border:1px solid #E2E3E3;">' .
        '<a href="' . email_esc($href) . '" style="display:block;color:#1B2A34;text-decoration:none;font-family:' . $sans .
        ';font-size:15px;font-weight:600;line-height:46px;border-radius:999px;">' . email_esc($label) . '</a>' .
        '</td></tr></table>';
}
// "Sun 6 – Fri 11 Sep": a stay range as people say it. The month is named once when both
// ends share it. Email-only, like email_date.
function email_range($fromIso, $toIso)
{
    $a = strtotime((string) $fromIso);
    $z = strtotime((string) $toIso);
    if (!$a || !$z) {
        return trim(email_date($fromIso, false) . ' – ' . email_date($toIso, false), ' –');
    }
    if (date('Y-m', $a) === date('Y-m', $z)) {
        return date('D j', $a) . ' – ' . date('D j M', $z);
    }
    return date('D j M', $a) . ' – ' . date('D j M', $z);
}
// WHAT HAPPENS NEXT, as steps a guest can tick off in their head. $steps = [[title,
// sub, done], …]: title and sub are PLAIN TEXT (escaped here), done is a bool. A tick
// for what has happened, an open circle for what has not — and no promise the system
// does not keep: callers state only steps they can stand behind.
function email_timeline($steps)
{
    $sans = email_sans();
    $out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 12px;">';
    foreach ($steps as $st) {
        $done = !empty($st[2]);
        $out .= '<tr><td width="28" valign="top" style="padding:8px 0;font-family:' . $sans . ';font-size:15px;font-weight:700;line-height:1.4;color:' .
            ($done ? '#29712D' : email_muted_ink()) . ';">' . ($done ? '&#10003;' : '&#9675;') . '</td>' .
            '<td valign="top" style="padding:8px 0;font-family:' . $sans . ';">' .
            '<div style="font-size:15px;font-weight:600;color:#1B2A34;line-height:1.4;">' . email_esc($st[0]) . '</div>' .
            (isset($st[1]) && $st[1] !== '' ? '<div style="font-size:13px;color:' . email_muted_ink() . ';line-height:1.5;">' . email_esc($st[1]) . '</div>' : '') .
            '</td></tr>';
    }
    return $out . '</table>';
}
// ARRIVE / LEAVE as a pair, side by side — the two facts a traveller checks first.
// Times are optional ('' prints nothing, never "from 12am").
function email_dates($inIso, $inTime, $outIso, $outTime)
{
    $sans = email_sans();
    $cell = function ($label, $iso, $time, $prep) use ($sans) {
        $t = email_time($time);
        return '<td width="50%" valign="top" style="padding:12px 0;border-top:1px solid #E2E3E3;border-bottom:1px solid #E2E3E3;font-family:' . $sans . ';">' .
            '<div style="font-size:13px;font-weight:600;color:' . email_muted_ink() . ';">' . $label . '</div>' .
            '<div style="font-size:17px;font-weight:700;letter-spacing:-0.01em;color:#1B2A34;line-height:1.4;">' . email_esc(email_date($iso)) . '</div>' .
            ($t !== '' ? '<div style="font-size:13px;color:' . email_muted_ink() . ';">' . $prep . ' ' . email_esc($t) . '</div>' : '') .
            '</td>';
    };
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 4px;"><tr>' .
        $cell('Arrive', $inIso, $inTime, 'from') . $cell('Leave', $outIso, $outTime, 'by') . '</tr></table>';
}
// Add the stay to a calendar in one tap. Google and Outlook take a link (no file); Apple
// Calendar opens the .ics the confirmation attaches. Pure: facts in, URLs out.
function email_cal_urls($b)
{
    $prop = trim((string) ($b['prop_name'] ?? '')) !== '' ? (string) $b['prop_name'] : 'Your cottage';
    $inT = trim((string) ($b['check_in_time'] ?? '')) !== '' ? (string) $b['check_in_time'] : '15:00';
    $outT = trim((string) ($b['check_out_time'] ?? '')) !== '' ? (string) $b['check_out_time'] : '10:00';
    $s = date('Ymd', strtotime((string) $b['check_in'])) . 'T' . date('Hi', strtotime('2000-01-01 ' . $inT)) . '00';
    $e = date('Ymd', strtotime((string) $b['check_out'])) . 'T' . date('Hi', strtotime('2000-01-01 ' . $outT)) . '00';
    $title = 'Stay at ' . $prop;
    $where = trim((string) ($b['address'] ?? ''));
    $google = 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' . rawurlencode($title) .
        '&dates=' . $s . '/' . $e . '&ctz=Europe%2FLondon' . ($where !== '' ? '&location=' . rawurlencode($where) : '');
    $outlook = 'https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject=' . rawurlencode($title) .
        '&startdt=' . rawurlencode(date('Y-m-d', strtotime((string) $b['check_in'])) . 'T' . date('H:i', strtotime('2000-01-01 ' . $inT)) . ':00') .
        '&enddt=' . rawurlencode(date('Y-m-d', strtotime((string) $b['check_out'])) . 'T' . date('H:i', strtotime('2000-01-01 ' . $outT)) . ':00') .
        ($where !== '' ? '&location=' . rawurlencode($where) : '');
    return ['google' => $google, 'outlook' => $outlook];
}
function email_cal_links($b)
{
    $u = email_cal_urls($b);
    $sans = email_sans();
    $link = fn($href, $label) => '<a href="' . email_esc($href) . '" style="font-family:' . $sans . ';font-size:13px;font-weight:600;color:' . email_accent_ink() . ';text-decoration:none;">' . $label . '</a>';
    return '<p style="font-family:' . $sans . ';font-size:13px;color:' . email_muted_ink() . ';line-height:1.9;margin:8px 0 0;">Add to your calendar: ' .
        $link($u['google'], 'Google') . ' &nbsp;&middot;&nbsp; ' . $link($u['outlook'], 'Outlook') .
        ' &nbsp;&middot;&nbsp; <span>Apple (the attached invite)</span></p>';
}
// Small print that is PROSE. email_rows() splits its content across two columns, so a
// sentence put through it wraps 2+2 lines and reads as a label beside a value.
// Pre-escaped HTML, like email_p().
function email_footnote($html)
{
    return '<p style="font-family:' . email_sans() . ';font-size:12px;line-height:1.6;color:' . email_muted_ink() . ';margin:12px 0 0;">' . $html . '</p>';
}
// MONEY ROWS: a price line is a sentence ("£130.00 × 3 nights"), so the label is body
// text in ink rather than email_rows()' muted field-name column, with the figure
// tabular on the right rail. $rows = [[labelHtml, valueHtml], …], both PRE-ESCAPED.
function email_money_rows($rows)
{
    $sans = email_sans();
    $out = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;">';
    $n = count($rows);
    $i = 0;
    foreach ($rows as $r) {
        $i++;
        $bd = $i < $n ? 'border-bottom:1px solid #E2E3E3;' : '';
        $out .= '<tr><td style="padding:12px 12px 12px 0;' . $bd . 'font-family:' . $sans . ';font-size:15px;color:#1B2A34;line-height:1.5;">' . $r[0] . '</td>' .
            '<td align="right" style="padding:12px 0;' . $bd . 'font-family:' . $sans .
            ';font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;color:#1B2A34;">' . $r[1] . '</td></tr>';
    }
    return $out . '</table>';
}
// THE OWNER'S OWN WORDS, ATTRIBUTED. The refund and cancellation emails printed
// "Reason: <whatever the owner typed>" as though the SITE were explaining itself — but
// that field is a note the owner wrote for their own records, and it reads very
// differently to the guest when presented as the email's own account of events.
// Returns '' for an empty note, so a blank reason renders nothing rather than a heading
// over white space.
function email_ownernote($who, $text)
{
    $text = trim((string) $text);
    if ($text === '') {
        return '';
    }
    $sans = email_sans();
    $who = trim((string) $who) !== '' ? $who : 'us';
    return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;"><tr>' .
        '<td bgcolor="#F4F4F2" style="background:#F4F4F2;border:1px solid #EBEBEA;border-radius:12px;padding:14px 16px;">' .
        '<div style="font-family:' . $sans . ';font-size:13px;font-weight:600;color:' . email_muted_ink() . ';padding-bottom:4px;">A note from ' .
        email_esc($who) . '</div>' .
        '<div style="font-family:' . $sans . ';font-size:15px;color:#1B2A34;line-height:1.6;">' .
        email_esc($text) . '</div></td></tr></table>';
}
// The host's name for those notes, falling back to the business.
function email_host_name()
{
    // content_value takes ONE argument and already returns '' for a missing key —
    // a second "default" is accepted at runtime and silently ignored, which is why
    // this only surfaced under PHPStan.
    $n = function_exists('content_value') ? trim((string) content_value('host-name')) : '';
    return $n !== '' ? $n : (defined('SITE_NAME') ? SITE_NAME : 'us');
}
// The owner's phone, for the emails where a guest most wants to ring: '' when unset, so
// callers render nothing rather than an empty "call us on".
function email_phone()
{
    return function_exists('content_value') ? trim((string) content_value('contact-phone')) : '';
}
// ============================================================
//  THE DARK TWIN — one palette definition, applied two ways.
//  email_dark_palette() is the single source: the shell's
//  @media (prefers-color-scheme: dark) block is BUILT from it, and
//  test-emails-render's dark contrast pass READS it, so the CSS that ships and
//  the palette the gate measures can never drift apart. Clients that honour the
//  media query (Apple Mail, most UK guests) get the back office's own dark theme;
//  Gmail ignores everyone's preferences and self-transforms regardless — these
//  values survive that transform too. The light rendering is unaffected: the
//  media block only ever fires in a dark client.
// ============================================================
function email_dark_palette()
{
    // The dashboard's :root, composited onto its #121316 ground: card #16171A (glass at
    // 1.8%), hairline #242528, well #1F2023, ink #F4F5F7, muted #B4B8C6, the accent
    // #D6A785 as fill AND text. A SURFACE's fill is a simple class rule (the render gate
    // measures those); its EDGE is a descendant rule declared after `.em-card td`, so a
    // well's own border outranks the hairline that rule sets.
    return [
        'body, .em-gr' => ['background' => '#121316'],
        '.em-card' => ['background' => '#16171A', 'border-color' => '#242528'],
        '.em-well' => ['background' => '#1F2023'],
        '.em-note' => ['background' => '#272424'],
        '.em-capok' => ['background' => '#1D2B21'],
        '.em-capwarn' => ['background' => '#342A1C'],
        '.em-capbad' => ['background' => '#312326'],
        '.em-capinfo' => ['background' => '#1C252B'],
        '.em-btn' => ['background' => '#D6A785'],
        '.em-card td' => ['border-color' => '#242528'],
        '.em-card .em-r2' => ['border-color' => '#4B4C4F'],
        '.em-card .em-well' => ['border-color' => '#28292C'],
        '.em-card .em-note' => ['border-color' => '#443A34'],
        '.em-card .em-capok' => ['border-color' => '#233B27'],
        '.em-card .em-capwarn' => ['border-color' => '#4E3A1D'],
        '.em-card .em-capbad' => ['border-color' => '#482D2F'],
        '.em-card .em-capinfo' => ['border-color' => '#22313A'],
        '.em-ink' => ['color' => '#F4F5F7'],
        '.em-mut' => ['color' => '#B4B8C6'],
        '.em-acc' => ['color' => '#D6A785'],
        '.em-ok' => ['color' => '#81C784'],
        '.em-warn' => ['color' => '#FFB74D'],
        '.em-bad' => ['color' => '#EF9A9A'],
        '.em-info' => ['color' => '#79AEC8'],
    ];
}
function email_dark_css()
{
    $out = '@media (prefers-color-scheme: dark){';
    foreach (email_dark_palette() as $sel => $props) {
        $out .= $sel . '{';
        foreach ($props as $p => $v) {
            $out .= $p . ':' . $v . ' !important;';
        }
        $out .= '}';
    }
    return $out . '}';
}
// THE HOOKS ARE INJECTED AT THE CHOKE POINT, NOT REMEMBERED AT 85 CALL SITES.
// The dark block overrides by CLASS, and this pass adds the class to every
// element whose inline ink or fill has a dark twin — run once by email_shell
// over the finished document, so a composer (or a future one) can never forget
// to opt in. The pdfSafe rule: a sanitiser you have to remember is one the next
// call site forgets. The one ink NOT in the map is the button's #1B1208: it sits on
// the accent in both themes (the fill is what changes, #C6885E → #D6A785), and reads
// 6.23:1 and 8.56:1 on them.
function email_dark_hooks($html)
{
    static $ink = null, $fill = null;
    if ($ink === null) {
        $ink = [
            '#1B2A34' => 'em-ink',
            strtoupper(email_muted_ink()) => 'em-mut',
            strtoupper(email_accent_ink()) => 'em-acc',
            '#29712D' => 'em-ok',
            strtoupper(email_warn_ink()) => 'em-warn',
            strtoupper(email_alert_ink()) => 'em-bad',
            '#316784' => 'em-info',
        ];
        $fill = [
            '#FDFCFA' => 'em-card', '#F5F1E9' => 'em-gr', '#F4F4F2' => 'em-well', '#F8F2EC' => 'em-note',
            '#C6885E' => 'em-btn',
            '#E6F2E4' => 'em-capok', '#FDF1DE' => 'em-capwarn', '#FAEAE8' => 'em-capbad', '#E5ECEE' => 'em-capinfo',
        ];
    }
    return preg_replace_callback('#<([a-z][a-z0-9]*)\b([^>]*)>#i', function ($m) use ($ink, $fill) {
        $attrs = $m[2];
        if (stripos($attrs, 'style=') === false && stripos($attrs, 'bgcolor=') === false) {
            return $m[0];
        }
        $add = [];
        if (preg_match('/(?<!-)\bcolor\s*:\s*(#[0-9A-Fa-f]{6})/i', $attrs, $c) && isset($ink[strtoupper($c[1])])) {
            $add[] = $ink[strtoupper($c[1])];
        }
        if (preg_match('/background(?:-color)?\s*:\s*(#[0-9A-Fa-f]{6})/i', $attrs, $b) && isset($fill[strtoupper($b[1])])) {
            $add[] = $fill[strtoupper($b[1])];
        } elseif (preg_match('/bgcolor\s*=\s*"(#[0-9A-Fa-f]{6})"/i', $attrs, $b) && isset($fill[strtoupper($b[1])])) {
            $add[] = $fill[strtoupper($b[1])];
        }
        if ($add === []) {
            return $m[0];
        }
        $add = array_unique($add);
        if (preg_match('/class\s*=\s*"([^"]*)"/i', $attrs, $k)) {
            $merged = array_unique(array_merge(preg_split('/\s+/', trim($k[1])) ?: [], $add));
            $attrs = str_replace($k[0], 'class="' . implode(' ', array_filter($merged)) . '"', $attrs);
            return '<' . $m[1] . $attrs . '>';
        }
        return '<' . $m[1] . ' class="' . implode(' ', $add) . '"' . $attrs . '>';
    }, $html);
}

// The cottage's face on the two emotional emails (confirmation + arrival).
// Pure: takes the data URI as an argument; '' renders nothing, never a broken
// image. Sits mid-column (below the header row) so the card's rounded corners
// are never in play.
function email_photo_band($dataUri, $alt)
{
    if ((string) $dataUri === '') {
        return '';
    }
    return '<tr><td style="padding:0;line-height:0;font-size:0;">' .
        '<img src="' . $dataUri . '" width="600" alt="' . email_esc($alt) . '" style="display:block;width:100%;height:auto;border:0;outline:none;">' .
        '</td></tr>';
}
// The IO half: first gallery image for the cottage, downscaled and inlined so
// default image-blocking cannot strip it (the crown's own rationale). NEVER
// throws and never returns a broken half: any refusal — no gallery, a remote
// URL, an unreadable file, no GD, an encode that comes out over ~66KB against
// Gmail's 102KB clip — returns '' and the email simply has no band.
function email_prop_photo($propKey)
{
    try {
        $propKey = (string) $propKey;
        if ($propKey === '' || !function_exists('content_value') || !function_exists('imagecreatetruecolor')) {
            return '';
        }
        $raw = content_value('images-' . $propKey);
        $list = $raw ? json_decode((string) $raw, true) : null;
        if (!is_array($list) || empty($list[0]) || !is_string($list[0])) {
            return '';
        }
        // Local uploads only — a remote URL is not ours to fetch at send time.
        $rel = ltrim($list[0], '/');
        if (preg_match('#^https?://#i', $list[0]) || strpos($rel, 'uploads/') !== 0 || strpos($rel, '..') !== false) {
            return '';
        }
        $path = __DIR__ . '/' . $rel;
        if (!is_file($path)) {
            return '';
        }
        $info = @getimagesize($path);
        if (!$info || empty($info[0])) {
            return '';
        }
        $im = null;
        if ($info[2] === IMAGETYPE_JPEG) {
            $im = @imagecreatefromjpeg($path);
        } elseif ($info[2] === IMAGETYPE_PNG) {
            $im = @imagecreatefrompng($path);
        } elseif ($info[2] === IMAGETYPE_WEBP && function_exists('imagecreatefromwebp')) {
            $im = @imagecreatefromwebp($path);
        }
        if (!$im) {
            return '';
        }
        $w = imagesx($im);
        $h = imagesy($im);
        $tw = min(560, $w);
        $th = max(1, (int) round($h * $tw / max(1, $w)));
        $out = imagecreatetruecolor($tw, $th);
        imagecopyresampled($out, $im, 0, 0, 0, 0, $tw, $th, $w, $h);
        ob_start();
        imagejpeg($out, null, 68);
        $jpg = ob_get_clean();
        imagedestroy($im);
        imagedestroy($out);
        if ($jpg === false || $jpg === '') {
            return '';
        }
        $b64 = base64_encode($jpg);
        if (strlen($b64) > 90000) {
            return '';
        }
        return 'data:image/jpeg;base64,' . $b64;
    } catch (\Throwable $e) {
        return '';
    }
}

// The full document shell. $inner = card body HTML. $opts: ['unsubscribe' => url,
// 'footer' => html, 'photo' => a rendered email_photo_band() row, seated between the
// header line and the content]. $accentBar is accepted and ignored: THERE IS NO
// ACCENT BAR. The dashboard's cards carry none, and three different bar colours
// (cottage / gold / rose) were the loudest inconsistency in the set — the cottage is
// named by its dot (email_eyebrow) where an email is about a stay.
function email_shell($preheader, $inner, $accentBar = '#C6885E', $opts = [])
{
    $sans = email_sans();
    $unsub = $opts['unsubscribe'] ?? '';
    $footerExtra = $opts['footer'] ?? '';
    $photo = $opts['photo'] ?? '';
    $doc = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">' .
        '<style>@import url("https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap");' .
        'body{margin:0;padding:0;background:#F5F1E9;}' .
        '@media (max-width:600px){.ec-wrap{width:100%!important;}.ec-pad{padding-left:20px!important;padding-right:20px!important;}}' .
        email_dark_css() .
        '</style></head>' .
        '<body style="margin:0;padding:0;background:#F5F1E9;">' .
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">' . email_esc($preheader) . '</div>' .
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#F5F1E9" style="background:#F5F1E9;"><tr><td align="center" style="padding:24px 12px 32px;">' .
        '<table role="presentation" width="600" class="ec-wrap" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">' .
        '<tr><td bgcolor="#FDFCFA" style="background:#FDFCFA;border:1px solid #E2E3E3;border-radius:20px;">' .
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' .
        email_crown_header('') .
        $photo .
        '<tr><td class="ec-pad" style="padding:24px 28px 28px;">' . $inner . '</td></tr>' .
        '</table>' .
        '</td></tr>' .
        '<tr><td class="ec-pad" style="padding:16px 28px 0;font-family:' . $sans . ';font-size:12px;color:' . email_muted_ink() . ';line-height:1.7;">' .
        'Self-catering holiday cottages in Blakeney, North Norfolk &middot; NR25<br>' .
        ($footerExtra !== '' ? $footerExtra . '<br>' : '') .
        ($unsub !== '' ? '<a href="' . email_esc($unsub) . '" style="color:' . email_muted_ink() . ';text-decoration:underline;">Unsubscribe</a>' : '') .
        '</td></tr>' .
        '</table></td></tr></table></body></html>';
    return email_dark_hooks($doc);
}

// Let the owner know money has landed. $b: id (the booking, for the deep link), name,
// prop_name, kind, amount, status.
// Pure — split out of send_owner_payment_notice so a gate can drive the REAL
// composer rather than reading its source (which proves the words exist, not
// that they are ever reached).
function owner_payment_notice_body($b)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $what = ($b['kind'] ?? '') === 'balance' ? 'balance' : 'deposit';
    // A SLICE IS NOT ITS STAGE — the same fact the guest's receipt carries. The
    // owner reading "Type: balance" beside £120 of a £290 balance would take the
    // booking as settled and stop chasing it.
    $typeLine = !empty($b['partial']) ? 'part payment towards the ' . $what : $what;
    $settled = ($b['status'] ?? '') === 'paid';
    $statusTxt = $settled ? ' — now paid in full' : '';
    $prop = $b['prop_name'] ?? ($b['prop_key'] ?? 'a cottage');
    // THE OWNER'S ACTUAL QUESTION IS "IS THAT THE LOT?" — and the only answer this
    // notice gave was the ABSENCE of "now paid in full", which is silence rather
    // than an answer: a deposit with a balance to come and a part payment that fell
    // short both read identically. The figure was already known at the call site
    // (pay.php holds the total and the new paid figure in the same closure) and was
    // simply not passed. Stated only when there is something left, and named in the
    // SUBJECT too, because that is the half read on a lock screen.
    $left = round((float) ($b['balance'] ?? 0), 2);
    $leftTxt = !$settled && $left > 0.005 ? 'Still to collect: ' . $money($left) : '';
    return [
        'subject' => 'Payment received: ' . $money($b['amount']) . " — {$prop}"
            . ($settled ? ' (paid in full)' : ($leftTxt !== '' ? ' — ' . $money($left) . ' still to collect' : '')),
        'text' =>
            "Good news — a payment has come in.\n\n" .
            'Guest: ' .
            ($b['name'] ?? '—') .
            "\n" .
            "Property: {$prop}\n" .
            "Type: {$typeLine}\n" .
            'Amount: ' .
            $money($b['amount']) .
            $statusTxt .
            "\n" .
            ($leftTxt !== '' ? $leftTxt . "\n" : '') .
            "\n" .
            "See Money & income for the full picture.\nCottage Holidays Blakeney" .
            (!empty($b['id']) ? owner_open_line('booking-' . (int) $b['id']) : ''),
    ];
}
function send_owner_payment_notice($b)
{
    // Guard on who would actually get it: the people who chose payment emails
    // and the extra addresses — an owner relying on the extras with a cleared
    // OWNER_NOTIFY_EMAIL once silently got NO payment notices from this path.
    if (!owner_recipients('paid')) {
        return ['ok' => false, 'error' => 'No owner email'];
    }
    $m = owner_payment_notice_body($b);
    return send_people('paid', $m['subject'], $m['text']);
}

// The day-after-checkout thank-you — PURE (facts in as arguments, like arrival_email_body), so
// the render gate drives the real thing. $b: name, prop_key, prop_name, check_in, check_out,
// deposit (the refundable amount charged, 0 for none), rebook_url, photo (data URI or '').
// It fills the silence between checkout and the review ask, leads with what a guest is
// wondering (their deposit), and makes the review request a follow-up rather than the
// first thing we say after they leave. It promises only what the system keeps: the
// deposit really is returned after checkout (and emailed), and the review ask really
// does follow in a day or two.
function thank_you_body($b)
{
    $accent = prop_display($b['prop_key'] ?? '')['accent'];
    $name = first_name($b['name'] ?? '', 'there');
    $prop = trim((string) ($b['prop_name'] ?? '')) !== '' ? (string) $b['prop_name'] : 'your cottage';
    $dep = round((float) ($b['deposit'] ?? 0), 2);
    $url = trim((string) ($b['rebook_url'] ?? ''));
    $range = !empty($b['check_in']) && !empty($b['check_out']) ? email_range($b['check_in'], $b['check_out']) : '';
    $depSentence = $dep > 0
        ? 'Your £' . number_format($dep, 2) . ' refundable deposit comes back after checkout, provided there’s no damage — we’ll email you when it’s on its way.'
        : '';
    $subject = "Thank you for staying, {$name}";
    $text =
        "Thank you for staying, {$name}.\n\n" .
        "We hope you had a lovely time at {$prop}" . ($range !== '' ? " ({$range})" : '') . " and that Blakeney treated you well.\n\n" .
        ($depSentence !== '' ? $depSentence . "\n\n" : '') .
        ($url !== '' ? "Coming back? Booking direct is the best price — no platform fees.\nSee dates & prices: {$url}\n\n" : '') .
        "In a day or two we'll ask how it went — it takes a minute and helps other guests.\n\n" .
        "Cottage Holidays Blakeney";
    $inner =
        email_h('Thank you for staying, ' . $name . '.') .
        email_p(
            'We hope you had a lovely time at <strong style="color:#1B2A34;">' . email_esc($prop) . '</strong>' .
                ($range !== '' ? ' (' . email_esc($range) . ')' : '') . ' and that Blakeney treated you well.',
        ) .
        ($depSentence !== '' ? email_note(email_esc($depSentence), $accent) : '') .
        ($url !== ''
            ? '<div style="font-family:' . email_sans() . ';font-size:15px;font-weight:700;color:#1B2A34;margin:22px 0 2px;">Coming back?</div>' .
                email_p('Booking direct is the best price &mdash; no platform fees &mdash; and the easiest way to get the weeks you like.', true) .
                email_btn($url, 'See dates & prices')
            : '') .
        email_footnote('In a day or two we&rsquo;ll ask how it went &mdash; it takes a minute and helps other guests.') .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell(
        'We hope ' . $prop . ' treated you well.' . ($dep > 0 ? ' Your deposit comes back after checkout.' : ''),
        $inner,
        $accent,
        ['photo' => email_photo_band((string) ($b['photo'] ?? ''), $prop)] +
            (trim((string) ($b['unsub'] ?? '')) !== '' ? ['unsubscribe' => (string) $b['unsub']] : []),
    );
    return ['subject' => $subject, 'text' => $text, 'html' => $html, 'name' => $name];
}
// Thin sender: resolves what the pure builder cannot (the photo and the cottage's own page).
function send_thank_you_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $b['photo'] = (string) ($b['photo'] ?? email_prop_photo($b['prop_key'] ?? ''));
    $b['rebook_url'] = (string) ($b['rebook_url'] ?? email_cottage_url($b['prop_key'] ?? ''));
    // It carries a come-back pitch, so it gets the same one-click unsubscribe the other
    // marketing-ish email (the anniversary invite) has — and the cron skips anyone on the list.
    $base = function_exists('site_base_url') ? site_base_url() : '';
    $b['unsub'] = (string) ($b['unsub'] ?? ($base && function_exists('email_optout_token')
        ? $base . 'email-optout.php?e=' . rawurlencode($b['email']) . '&t=' . email_optout_token($b['email'])
        : ''));
    $m = thank_you_body($b);
    $headers = $b['unsub'] !== ''
        ? ['List-Unsubscribe' => '<' . $b['unsub'] . '>', 'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click']
        : [];
    return smtp_send($b['email'], $m['name'], $m['subject'], $m['text'], $m['html'], [], null, null, $headers);
}

// Ask a past guest to leave a review. $b: name, email, prop_key, prop_name, reviewUrl.
function send_review_request_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'there');
    $prop = $b['prop_name'] ?: 'your cottage';
    $url = $b['reviewUrl'] ?? '';
    // Google review funnel: if the owner has set a Google review link, make it the
    // primary call to action (best for search ranking + social proof); the on-site
    // review form stays as a secondary option.
    $googleUrl = $b['googleUrl'] ?? '';

    // A QUESTION, NOT A CHORE. "How was Jollyboat? Leave a review" put the ask in
    // the subject line, where it reads as a task the guest has been given; the
    // question alone invites the reply, and the ask is inside where it belongs.
    $subject = "How was your stay at {$prop}?";
    $text =
        "Hello {$name},\n\n" .
        "Thank you for staying at {$prop}. We'd love to hear how it went — a short review " .
        "really helps other guests (and us).\n\n" .
        // "Or review us on our site" with no Google link above it began the
        // sentence with a dangling "Or" — the HTML half branched on $googleUrl and
        // this half never did.
        ($googleUrl ? "Leave us a Google review: {$googleUrl}\n\n" : '') .
        ($url ? ($googleUrl ? 'Or review us on our site' : 'Review us on our site') . ": {$url}\n\n" : '') .
        "We hope to welcome you back.\nCottage Holidays Blakeney";

    $inner =
        email_h('How was your stay?') .
        email_p(
            'Hello ' .
                $esc($name) .
                ', thank you for staying at <strong style="color:#1B2A34;">' .
                $esc($prop) .
                '</strong>. We\'d love to hear how it went — a short review really helps other guests (and us).',
        );
    // THE STARS COME TO THE INBOX. One tap carries the rating into the on-site
    // review form pre-filled (?stars=N — the same pre-fill the My Stays star-tap
    // performs), so the guest arrives mid-thought instead of at a blank form.
    // The buttons below stay as the fallback for clients that mangle glyphs.
    if ($url) {
        $sep = strpos($url, '?') === false ? '?' : '&';
        $stars = '';
        for ($n = 1; $n <= 5; $n++) {
            // email_accent_ink(), not the accent: a star glyph is still TEXT to a
            // renderer, and the fill value measures 2.55:1 on white (the words-vs-
            // things rule the whole design system follows).
            $stars .=
                '<a href="' . email_esc($url . $sep . 'stars=' . $n) . '" aria-label="' . $n . ' star' . ($n === 1 ? '' : 's') . '" ' .
                'style="text-decoration:none;font-size:34px;line-height:1.2;color:' . email_accent_ink() . ';padding:0 6px;">&#9733;</a>';
        }
        $inner .=
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0 0;"><tr><td align="center">' .
            '<div style="font-family:' . email_sans() . ';font-size:13px;font-weight:600;color:' . email_muted_ink() . ';padding-bottom:4px;">Tap a star to start</div>' .
            '<div>' . $stars . '</div>' .
            '<div style="font-family:' . email_sans() . ';font-size:12px;color:' . email_muted_ink() . ';padding-top:4px;">Your rating arrives filled in &mdash; add as much or as little as you like.</div>' .
            '</td></tr></table>';
    }
    if ($googleUrl) {
        $inner .= email_btn($googleUrl, '★ Review us on Google');
    }
    if ($url) {
        // THE HOUSE SECONDARY BUTTON, not a bespoke 13px centred link. This was the
        // only inline-styled anchor left in the file, written before email_btn2()
        // existed — so the alternative to Google was a 13px line of text against a
        // 44px button, which is not a choice so much as a hint. Now it is the second
        // option, at the same tap size, visibly quieter.
        $inner .= $googleUrl ? email_btn2($url, 'Or review us on our site') : email_btn($url, 'Leave a review');
    }
    $inner .= email_p('We hope to welcome you back.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Two taps and it\'s done — tap a star to start', $inner, $accent);

    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Anniversary re-invite: ~11 months after a stay, invite the guest back for the
// same season next year (sent once per booking by anniversary-nudge.php).
function send_anniversary_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent'];
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = ($b['name'] ?? '') !== '' ? preg_split('/\s+/', trim($b['name']))[0] : 'there';
    $prop = $b['prop_name'] ?: 'the cottage';
    $month = date('F', strtotime($b['check_in'] ?? 'now'));
    $url = function_exists('site_base_url') ? site_base_url() : '';

    // Real one-click unsubscribe (this is a marketing-ish email): a signed
    // email-optout.php link in the footer + RFC 8058 headers so mail clients
    // show their own Unsubscribe control. anniversary-nudge.php skips anyone
    // on the suppression list before ever calling this.
    $unsub = $url && function_exists('email_optout_token')
        ? $url . 'email-optout.php?e=' . rawurlencode($b['email']) . '&t=' . email_optout_token($b['email'])
        : '';

    // The cottage's own page, not the homepage — see email_cottage_url.
    $bookUrl = email_cottage_url($b['prop_key'] ?? '');
    $subject = "{$month} at {$prop} — fancy a return visit?";
    $text =
        "Hello {$name},\n\n" .
        "Around this time last year you were getting ready for your stay at {$prop} — " .
        "we hope Blakeney has stayed with you the way it tends to.\n\n" .
        "The same {$month} weeks are starting to book up again, so if you fancy a return " .
        "we wanted you to have first pick of the dates.\n\n" .
        ($bookUrl ? "See {$prop}'s dates and prices: {$bookUrl}\n\n" : '') .
        "Hope to welcome you back,\nCottage Holidays Blakeney\n\n" .
        ($unsub
            ? "Prefer not to get the occasional note like this? Unsubscribe in one tap: {$unsub}"
            : 'P.S. Prefer not to get the occasional note like this? Just reply and say so.');

    $inner =
        email_h('Fancy a return visit?') .
        email_p(
            'Hello ' .
                $esc($name) .
                ', around this time last year you were getting ready for your stay at <strong style="color:#1B2A34;">' .
                $esc($prop) .
                '</strong> — we hope Blakeney has stayed with you the way it tends to.',
        ) .
        email_p(
            'The same <strong style="color:#1B2A34;">' .
                $esc($month) .
                '</strong> weeks are starting to book up again, so we wanted you to have first pick of the dates.',
        );
    if ($bookUrl) {
        // Named for the destination. "Check availability" describes a lookup; this
        // button opens the cottage's own page, where the dates AND the live price
        // are — which is what the guest is actually deciding on.
        $inner .= email_btn($bookUrl, 'See dates & prices');
    }
    $inner .= email_p('Hope to welcome you back,<br>Cottage Holidays Blakeney', true);
    // THE UNSUBSCRIBE GOES IN THE FOOTER, WHICH ALREADY HAS A SLOT FOR IT.
    // email_shell takes ['unsubscribe' => url] and renders it beside the other
    // footer text — the place a reader looks for it and the place the RFC 8058
    // header points at. This composer hand-rolled its own body paragraph instead,
    // so the shell's slot rendered nothing while a full sentence about opting out
    // sat immediately under the sign-off, in the body, as though it were part of
    // the message. Only the no-signed-link fallback stays in the body, because
    // "just reply and say so" is an instruction rather than a link.
    $inner .= $unsub === '' ? email_footnote('Prefer not to get the occasional note like this? Just reply and say so.') : '';
    $html = email_shell($month . ' at ' . $prop, $inner, $accent, $unsub !== '' ? ['unsubscribe' => $unsub] : []);

    $headers = $unsub
        ? ['List-Unsubscribe' => '<' . $unsub . '>', 'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click']
        : [];
    return smtp_send($b['email'], $b['name'] ?? '', $subject, $text, $html, [], null, null, $headers);
}

// Book-direct re-invite for an EXTERNAL guest who left a review via a /review
// link (~a year on). The whole point is to convert an Airbnb/Vrbo guest into a
// direct booking: best price, no platform fees. $lead: name, email, prop_key.
// Sent once per lead by direct-followup.php; low privately-rated guests are
// filtered out before we ever get here.
function send_direct_followup_email($lead)
{
    if (empty($lead['email'])) {
        return ['ok' => false, 'error' => 'No email on file'];
    }
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = ($lead['name'] ?? '') !== '' ? preg_split('/\s+/', trim($lead['name']))[0] : 'there';
    $prop = prop_display($lead['prop_key'] ?? '')['name'] ?: 'our cottage';
    $url = function_exists('site_base_url') ? site_base_url() : '';
    $sans = email_sans();
    $serif = email_serif();

    // The cottage's own first gallery photo, as an absolute URL, becomes the
    // hero — this is what turns a note into an invitation back to the place.
    $img = '';
    $abs = function ($p) use ($url) {
        $p = trim((string) $p);
        if ($p === '') {
            return '';
        }
        if (preg_match('#^https?://#i', $p)) {
            return $p;
        }
        return $url !== '' ? rtrim($url, '/') . '/' . ltrim($p, '/') : '';
    };
    if (function_exists('content_json')) {
        $imgs = content_json('images-' . ($lead['prop_key'] ?? ''), []);
        if (is_array($imgs) && !empty($imgs[0]) && is_string($imgs[0])) {
            $img = $abs($imgs[0]);
        }
    }
    if ($img === '' && function_exists('content_value')) {
        $hb = content_value('hero-bg');
        if ($hb) {
            $img = $abs($hb);
        }
    }

    // Real one-click unsubscribe (this is a marketing email) + RFC 8058 headers.
    $unsub = $url && function_exists('email_optout_token')
        ? $url . 'email-optout.php?e=' . rawurlencode($lead['email']) . '&t=' . email_optout_token($lead['email'])
        : '';

    $bookUrl = email_cottage_url($lead['prop_key'] ?? '');
    $subject = "The coast is calling — come back to {$prop}, direct";
    $text =
        "Hello {$name},\n\n" .
        "Thank you again for your lovely review of {$prop} — it genuinely made our week.\n\n" .
        "If North Norfolk is on your mind again — the big skies over the marshes, the walk down to the " .
        "quay, the hush once the day-trippers have gone — we'd love to have you back.\n\n" .
        "And here's the best part: book DIRECT with us and you skip the booking-site fees entirely. Best " .
        "price, no middle-man — just you and the people who look after the cottage.\n\n" .
        ($bookUrl ? "See dates & book direct: {$bookUrl}\n\n" : '') .
        "We'd love to welcome you back,\nCottage Holidays Blakeney\n\n" .
        ($unsub ? "Prefer not to get the occasional note like this? Unsubscribe in one tap: {$unsub}" : '');

    // Framed hero photo (rounded; degrades to a plain image in Outlook).
    $hero = $img !== ''
        ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:0 0 6px;">' .
            '<img src="' . email_esc($img) . '" alt="' . $esc($prop) . '" width="528" ' .
            'style="display:block;width:100%;max-width:528px;height:auto;border-radius:12px;border:0;outline:none;">' .
            '</td></tr></table>'
        : '';
    $tag = email_caption('Book direct · best price');
    $head = email_h('The coast is calling you back');
    $highlights = email_footnote('Blakeney Quay &nbsp;&middot;&nbsp; The Coastal Path &nbsp;&middot;&nbsp; Seal trips to the Point');

    $inner =
        $hero .
        $tag .
        $head .
        email_p(
            'Hello ' .
                $esc($name) .
                ', thank you again for your lovely review of <strong style="color:#1B2A34;">' .
                $esc($prop) .
                '</strong> — it genuinely made our week.',
        ) .
        email_p(
            'If North Norfolk is on your mind again — the big skies over the marshes, the walk down to the quay, the hush once the day-trippers have gone — we\'d love to have you back.',
        ) .
        email_p(
            'And here\'s the best part: book <strong style="color:#1B2A34;">direct</strong> with us and you skip the booking-site fees entirely. <strong style="color:#1B2A34;">Best price</strong>, no middle-man — just you and the people who look after the cottage.',
        ) .
        $highlights;
    if ($bookUrl) {
        $inner .= email_btn($bookUrl, 'See dates & book direct');
    }
    $inner .= email_p('We\'d love to welcome you back,<br>Cottage Holidays Blakeney', true);
    // Footer slot, for the reason set out in send_anniversary_email.
    $inner .= $unsub === '' ? email_footnote('Prefer not to get the occasional note like this? Just reply and say so.') : '';
    // Brand rose-gold accent bar (not a per-cottage colour) — one coherent look.
    $html = email_shell(
        'Come back to ' . $prop . ' — book direct and skip the fees',
        $inner,
        '#C6885E',
        $unsub !== '' ? ['unsubscribe' => $unsub] : [],
    );

    $headers = $unsub
        ? ['List-Unsubscribe' => '<' . $unsub . '>', 'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click']
        : [];
    return smtp_send($lead['email'], $lead['name'] ?? '', $subject, $text, $html, [], null, null, $headers);
}

// Acknowledge a guest's enquiry by email. $accountExists tailors the closing line:
// returning guests are pointed to sign in; new guests are invited to create an account.
function send_enquiry_ack($enq, $accountExists = false)
{
    $email = trim((string) ($enq['email'] ?? ''));
    if ($email === '') {
        return ['ok' => false, 'error' => 'no email'];
    }
    $name = first_name($enq['name'] ?? '', 'there');
    $first = explode(' ', $name)[0] ?: 'there';
    $prop = function_exists('prop_display') ? prop_display($enq['prop_key'] ?? '')['name'] ?? '' : '';
    $pretty = fn($d) => $d ? email_date($d) : '';
    $dates = trim($pretty($enq['check_in'] ?? '') . ' to ' . $pretty($enq['check_out'] ?? ''), ' to');
    $url = function_exists('site_base_url') ? site_base_url() : '/';
    $acctLine = $accountExists
        ? 'You already have an account with us — sign in to track this enquiry and manage your bookings.'
        : 'Tip: create an account next time you visit (just set a password) to track this enquiry, message us and book faster.';

    // THE PROMISE IN THE SUBJECT: the one question this email answers is "when do I hear
    // back?", so it is readable before the email is opened.
    $subject = "We've got your enquiry" . ($prop ? " for {$prop}" : '') . " — we'll reply within a day";
    // The preheader is the line the inbox shows beside the subject, so it earns its
    // place by carrying the answer to the next question rather than repeating the
    // subject back — which is what "We've received your enquiry" did.
    // PLAIN TEXT, not HTML: email_shell runs email_esc() over the preheader, so an
    // entity here ships as the literal characters "&rsquo;" in the inbox preview
    // (and a pre-escaped cottage name would double-escape) — the same
    // escape-at-the-boundary asymmetry email_h/email_p have.
    $pre = "We'll confirm your dates and price" . ($prop ? ' for ' . $prop : '') . ' — usually within a few hours.';
    $text =
        "Hello {$first},\n\n" .
        'Thanks for your enquiry' .
        ($prop ? " about {$prop}" : '') .
        ($dates ? " for {$dates}" : '') .
        ".\n" .
        "We'll check availability and email you back to confirm your dates and price —\n" .
        "usually within a few hours, and always by the end of the next day.\n\n" .
        $acctLine .
        "\n" .
        $url .
        "\n\n" .
        'Cottage Holidays Blakeney';

    $inner =
        email_h('Thanks, ' . $first . ' — we\'ve got it.') .
        email_p(
            'Thanks for your enquiry' .
                ($prop ? ' about <strong style="color:#1B2A34;">' . email_esc($prop) . '</strong>' : '') .
                ($dates ? ' for <strong style="color:#1B2A34;">' . email_esc($dates) . '</strong>' : '') .
                '.',
        ) .
        // WHEN, not just WHAT. The one question this email leaves a guest with is
        // "so when do I hear back?" — an acknowledgement that answers it stops them
        // wondering whether to chase, or to enquire somewhere else while they wait.
        // Two bounds deliberately: the typical case sets the expectation, the outer
        // one is the promise, so a busy day doesn't read as being ignored.
        email_p(
            "We'll check availability and email you back to confirm your dates and price — " .
                'usually within a few hours, and always by the end of the next day.',
            true,
        ) .
        email_note(email_esc($acctLine)) .
        email_btn($url, $accountExists ? 'Sign in' : 'Visit the site');
    $html = email_shell($pre, $inner);
    // One-shot with no stamp-on-success cron behind it: a transport blip used
    // to lose the promise email forever. Queue-on-failure (the outbox rules).
    return smtp_send_reliable('enquiry-ack', $email, $name, $subject, $text, $html);
}

// THE OWNER'S OWN EMAIL TO A GUEST — the Email guest sheet's one template, for a
// booking and for an enquiry. Built WITHOUT sending, so the composer's preview and
// the send are byte for byte the same document. Pure: the sender's name and the
// booking's payment facts are resolved by the CALLER and passed in.
//
// The shape is the house one: the stay (dot + cottage + dates), the SUBJECT as the
// title (not "About your booking" on every email), the template's own greeting
// ("Hello <first name>," — so a body must never greet), the owner's words, then the
// person who wrote them. Below that, what the owner chose to add:
//   - `stay`  (default on): the arrive/leave pair and the party, plus for a
//     booking the link back into it (pay, directions and the door code live there);
//   - `money` (default on): for a BOOKING what is paid and what is left — never the
//     price again — and for an ENQUIRY the quote, one coherent line when the price
//     is custom (an agreed figure or a fee folded in never reads "3 nights at £130,
//     £401.70" again).
// $opts: from (sender's first name, '' = the business only), stay, money.
// $e may carry pay_paid / pay_due / pay_due_by (a booking's payment facts).
function build_enquiry_reply_email($e, $subject, $message, $ctx = 'enquiry', $opts = [])
{
    $booking = $ctx === 'booking';
    $noun = $booking ? 'booking' : 'enquiry';
    $pd = function_exists('prop_display') ? prop_display($e['prop_key'] ?? '') : [];
    $prop = (string) (($pd['name'] ?? '') !== '' ? $pd['name'] : ($e['prop_key'] ?? ''));
    $dot = (string) ($pd['accent'] ?? '#C6885E');
    $name = first_name($e['name'] ?? '', 'Guest');
    $from = trim((string) ($opts['from'] ?? ''));
    $incStay = !array_key_exists('stay', $opts) || !empty($opts['stay']);
    $incMoney = !array_key_exists('money', $opts) || !empty($opts['money']);
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $sans = email_sans();
    $adults = (int) ($e['adults'] ?? 0);
    $kids = (int) ($e['children'] ?? 0);
    $party = $adults . ' adult' . ($adults === 1 ? '' : 's') . ($kids ? ', ' . $kids . ' child' . ($kids === 1 ? '' : 'ren') : '');
    $inT = trim((string) ($e['check_in_time'] ?? '')) !== '' ? (string) $e['check_in_time'] : '15:00';
    $outT = trim((string) ($e['check_out_time'] ?? '')) !== '' ? (string) $e['check_out_time'] : '10:00';
    $stayUrl = site_base_url() . 'index.html?open=stay';

    $subject = trim((string) $subject);
    if ($subject === '') {
        $subject = $booking ? 'Your stay at ' . $prop : 'Your enquiry about ' . $prop;
    }
    $message = trim((string) $message);

    // ---- what is added below the message ----
    $stayRows = [];
    $stayText = '';
    if ($incStay && !empty($e['check_in'])) {
        $stayText = 'Arrive: ' . email_date($e['check_in']) . ', from ' . email_time($inT) . "\n"
            . 'Leave:  ' . email_date($e['check_out'] ?? '') . ', by ' . email_time($outT) . "\n"
            . "Party:  {$party}\n";
        $stayRows[] = ['Party', email_esc($party)];
    }
    $payRows = [];
    $payText = '';
    $hasPay = array_key_exists('pay_due', $e) || array_key_exists('pay_paid', $e);
    if ($booking && $incMoney && $hasPay) {
        $due = round((float) ($e['pay_due'] ?? 0), 2);
        $paid = round((float) ($e['pay_paid'] ?? 0), 2);
        $by = trim((string) ($e['pay_due_by'] ?? ''));
        if ($due > 0.005) {
            if ($paid > 0.005) {
                $payRows[] = ['Paid so far', email_esc($money($paid))];
                $payText .= 'Paid so far: ' . $money($paid) . "\n";
            }
            $payRows[] = ['Still to pay', email_esc($money($due))
                . ($by !== '' ? '<div style="font-size:13px;font-weight:400;color:' . email_muted_ink() . ';">by ' . email_esc(email_date($by, false)) . '</div>' : '')];
            $payText .= 'Still to pay: ' . $money($due) . ($by !== '' ? ', by ' . email_date($by, false) : '') . "\n";
        } else {
            $payRows[] = ['Payment', email_cap('ok', 'Paid in full')];
            $payText .= "Payment: paid in full\n";
        }
    }
    $quote = '';
    $quoteText = '';
    $p = is_array($e['price'] ?? null) ? $e['price'] : null;
    if (!$booking && $incMoney && $p && isset($p['total'])) {
        $nights = (int) ($p['nights'] ?? 0);
        $nightly = (float) ($p['nightly'] ?? ((float) ($p['perNight'] ?? 0) * $nights));
        $fee = (float) ($p['txFee'] ?? 0);
        $custom = !empty($p['agreedQuote']) || abs(($nightly + $fee) - (float) $p['total']) > 0.005;
        $q = [];
        if ($custom) {
            $q[] = [email_esc('Agreed price for your stay (' . $nights . ' night' . ($nights === 1 ? '' : 's') . ')'), email_esc($money($p['total']))];
            $quoteText = 'Agreed price for your stay: ' . $money($p['total']) . "\n";
        } else {
            $q[] = [email_esc($nights . ' night' . ($nights === 1 ? '' : 's') . ' at ' . $money($p['perNight'] ?? 0)), email_esc($money($nightly))];
            $quoteText = $nights . ' night' . ($nights === 1 ? '' : 's') . ' at ' . $money($p['perNight'] ?? 0) . ': ' . $money($nightly) . "\n";
            if ($fee > 0.005) {
                $pct = (float) ($p['transactionPct'] ?? 0);
                $feeLbl = 'Transaction fee' . ($pct > 0 ? ' (' . rtrim(rtrim(number_format($pct, 2), '0'), '.') . '%)' : '');
                $q[] = [email_esc($feeLbl), email_esc($money($fee))];
                $quoteText .= $feeLbl . ': ' . $money($fee) . "\n";
            }
            $q[] = ['<strong>Total</strong>', '<strong>' . email_esc($money($p['total'])) . '</strong>'];
            $quoteText .= 'Total: ' . $money($p['total']) . "\n";
        }
        if (!empty($p['damagesDeposit'])) {
            $q[] = ['Refundable damage deposit', email_esc($money($p['damagesDeposit']))];
            $quoteText .= 'Refundable damage deposit: ' . $money($p['damagesDeposit']) . "\n";
        }
        $quote = email_caption('Your quote') . email_money_rows($q)
            . (!empty($p['damagesDeposit']) ? email_footnote('The damage deposit is charged with your first payment and refunded after your stay.') : '');
    }
    $link = '<p style="font-family:' . $sans . ';font-size:15px;margin:8px 0 0;"><a href="' . email_esc($stayUrl)
        . '" style="color:' . email_accent_ink() . ';font-weight:600;text-decoration:none;">Open my booking &rsaquo;</a></p>';
    $added = '';
    if ($stayRows) {
        $added .= email_caption($booking ? 'Your stay' : 'Your dates')
            . email_dates($e['check_in'], $inT, $e['check_out'] ?? $e['check_in'], $outT)
            . email_rows(array_merge($stayRows, $payRows))
            . ($booking ? $link : '');
    } elseif ($payRows) {
        $added .= email_caption('Payment') . email_rows($payRows) . $link;
    }
    $added .= $quote;

    $signHtml = ($from !== '' ? email_esc($from) . '<br>' : '')
        . '<span style="color:' . email_muted_ink() . ';">Cottage Holidays Blakeney</span>';
    $replyTo = $from !== '' ? $from : 'us';
    $inner =
        email_eyebrow($dot, $prop . (!empty($e['check_in']) ? ' · ' . email_range($e['check_in'], $e['check_out'] ?? '') : '')) .
        email_h($subject) .
        email_p('Hello ' . email_esc($name) . ',') .
        // Owner-typed words: escaped here, line breaks kept (email_p expects pre-escaped HTML).
        email_p(nl2br(email_esc($message))) .
        email_p($signHtml) .
        $added .
        email_footnote('Reply to this email and it comes straight to ' . email_esc($replyTo) . '.');
    // The preheader finishes the thought: the start of what the owner wrote, not
    // the subject again. Plain text — the shell escapes it.
    $pre = mb_substr(preg_replace('/\s+/u', ' ', $message), 0, 110);
    $html = email_shell($pre !== '' ? $pre : $subject, $inner);

    $added = trim($stayText . $payText . $quoteText);
    $addedCap = $stayText !== '' ? ($booking ? 'Your stay' : 'Your dates') : ($booking ? 'Payment' : 'Your quote');
    $text =
        "Hello {$name},\n\n" .
        $message . "\n\n" .
        ($from !== '' ? $from . "\n" : '') . "Cottage Holidays Blakeney\n" .
        ($added !== '' ? "\n---\n" . $addedCap . "\n" . $added . "\n" : '') .
        ($booking && ($stayText !== '' || $payText !== '') ? "Open my booking: {$stayUrl}\n" : '') .
        "\nReply to this email and it comes straight to {$replyTo}.";

    return ['email' => $e['email'] ?? '', 'name' => $name, 'subject' => $subject, 'text' => $text, 'html' => $html];
}
// Send it: built by build_enquiry_reply_email() so the sent email is byte-identical
// to the composer's preview.
function send_enquiry_reply_email($e, $subject, $message, $ctx = 'enquiry', $attachments = [], $opts = [])
{
    $noun = $ctx === 'booking' ? 'booking' : 'enquiry';
    if (empty($e['email'])) {
        return ['ok' => false, 'error' => 'No guest email on this ' . $noun];
    }
    $m = build_enquiry_reply_email($e, $subject, $message, $ctx, $opts);
    return smtp_send($m['email'], $m['name'], $m['subject'], $m['text'], $m['html'], is_array($attachments) ? $attachments : []);
}
// The reply's options from the composer's request: who signs it (the person signed
// in, else the host) and the two "added below" switches, both on unless switched off.
// Resolved here, by the sender, so the composer above stays pure.
function reply_email_opts(array $in): array
{
    $me = function_exists('admin_me') ? admin_me() : null;
    $from = first_name((string) ($me['name'] ?? ''), '');
    if ($from === '') {
        // The host's name — but never the business's, which the sign-off already prints.
        $host = email_host_name();
        $from = (defined('SITE_NAME') && $host === SITE_NAME) || $host === 'us' ? '' : first_name($host, '');
    }
    return [
        'from' => $from,
        'stay' => !array_key_exists('include_stay', $in) || !empty($in['include_stay']),
        'money' => !array_key_exists('include_money', $in) || !empty($in['include_money']),
    ];
}

// Validate + normalise attachments from a JSON email_guest payload (admin-only)
// into smtp_send's format: [['filename','mime','content'(RAW bytes)], …]. Caps
// count/size, sanitises filenames, and decodes the base64 content.
function sanitize_email_attachments($raw)
{
    if (!is_array($raw)) {
        return [];
    }
    $allowed = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif',
        'application/pdf', 'text/plain', 'text/calendar',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    $out = [];
    $total = 0;
    foreach ($raw as $a) {
        if (count($out) >= 4) {
            break;
        }
        $content = base64_decode((string) ($a['content'] ?? ''), true);
        if ($content === false || $content === '') {
            continue;
        }
        $len = strlen($content);
        if ($len > 4 * 1024 * 1024) {
            continue; // 4 MB per file
        }
        $total += $len;
        if ($total > 8 * 1024 * 1024) {
            break; // 8 MB total
        }
        $filename = preg_replace('/[^A-Za-z0-9._ \-]/', '_', (string) ($a['filename'] ?? 'attachment'));
        $filename = mb_substr(trim($filename) !== '' ? trim($filename) : 'attachment', 0, 120);
        $mime = (string) ($a['mime'] ?? '');
        if (!in_array($mime, $allowed, true)) {
            $mime = 'application/octet-stream'; // still attach, but as a generic file
        }
        $out[] = ['filename' => $filename, 'mime' => $mime, 'content' => $content];
    }
    return $out;
}

// New-enquiry alert for the owner, with signed one-tap action links. $e carries
// the enquiry fields + prebuilt approve_url / decline_url (enquiry-action.php).
function send_owner_enquiry_email($e)
{
    // The extra addresses count too (see send_owner_payment_notice above).
    if (!owner_recipients('enquiry')) {
        return ['ok' => false, 'error' => 'No owner email'];
    }
    $prop = function_exists('prop_display')
        ? prop_display($e['prop_key'] ?? '')['name'] ?? ($e['prop_key'] ?? '')
        : $e['prop_key'] ?? '';
    $party =
        (int) ($e['adults'] ?? 0) .
        ' adult' .
        ((int) ($e['adults'] ?? 0) === 1 ? '' : 's') .
        ((int) ($e['children'] ?? 0)
            ? ' + ' . (int) $e['children'] . ' child' . ((int) $e['children'] === 1 ? '' : 'ren')
            : '');
    // WHO, WHERE, WHEN AND HOW MUCH, readable on a lock screen — the four things the
    // decision starts from. The quote is the site's own figure; absent, it is simply left out.
    $quoteTotal = is_array($e['price'] ?? null) && isset($e['price']['total']) ? ' (£' . number_format((float) $e['price']['total'], 2) . ')' : '';
    $subject =
        'New enquiry: ' . ($e['name'] ?: 'Someone') . ' — ' . $prop . ', ' . email_range($e['check_in'], $e['check_out']) . $quoteTotal;

    // Full booking context so the owner can decide (and reply) straight from the
    // inbox without opening the back office: contact, address, times, the price
    // the site quoted, and whether this guest has stayed before.
    $p = is_array($e['price'] ?? null) ? $e['price'] : null;
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $priceLine = $p
        ? $money($p['total']) .
            ' (' . (int) $p['nights'] . ' night' . ((int) $p['nights'] === 1 ? '' : 's') .
            ' × ' . $money($p['perNight'] ?? ($p['nights'] ? $p['nightly'] / max(1, $p['nights']) : 0)) . ')' .
            (!empty($p['damagesDeposit']) ? ' + ' . $money($p['damagesDeposit']) . ' refundable deposit (charged with the first payment, refunded after the stay)' : '')
        : '';
    $times = ($e['check_in_time'] ?? '') !== '' || ($e['check_out_time'] ?? '') !== ''
        ? 'Arrive ' . email_time($e['check_in_time'] ?: '15:00') . ' · leave ' . email_time($e['check_out_time'] ?: '10:00')
        : '';
    $addr = trim(implode(', ', array_filter([trim((string) ($e['address'] ?? '')), trim((string) ($e['postcode'] ?? ''))])));
    $prior = (int) ($e['prior_stays'] ?? 0);

    $text =
        "A new enquiry just arrived.\n\n" .
        'Guest: ' . ($e['name'] ?? '—') . ($prior > 0 ? ' — RETURNING GUEST (' . $prior . ' past stay' . ($prior === 1 ? '' : 's') . ')' : '') . "\n" .
        'Email: ' . ($e['email'] ?? '—') . "\n" .
        (!empty($e['phone']) ? 'Phone: ' . $e['phone'] . "\n" : '') .
        ($addr !== '' ? 'Address: ' . $addr . "\n" : '') .
        "Cottage: {$prop}\n" .
        'Dates: ' . email_date($e['check_in'] ?? '') . ' to ' . email_date($e['check_out'] ?? '') . "\n" .
        ($times !== '' ? $times . "\n" : '') .
        "Party: {$party}\n" .
        ($priceLine !== '' ? 'Estimated price: ' . $priceLine . "\n" : '') .
        (!empty($e['message']) ? 'Message: ' . $e['message'] . "\n" : '') .
        "\nApprove (creates the booking + confirmation & payment emails):\n" .
        $e['approve_url'] .
        "\n\n" .
        "Decline (deletes the enquiry):\n" .
        $e['decline_url'] .
        "\n\n" .
        'Each link opens a confirmation page first — nothing happens until you press the button there.';

    // Detail rows in the HOUSE block (email_rows), like every other summary in
    // this file — this composer had its own 13px/14px table, the twin of the one in
    // build_enquiry_reply_email, so the owner's copy and the guest's copy of the
    // same facts were laid out by two different pieces of code.
    //
    // THE CONTACTS ARE TAPPABLE. This email is read on a phone, and deciding on an
    // enquiry often means ringing the guest — the address and number were plain
    // text, so that meant copying a number out of an email by hand. mailto:/tel:
    // (tel: strips everything but digits and a leading +, since the owner's guests
    // type numbers with spaces and brackets).
    $dRows = [];
    $gEmail = trim((string) ($e['email'] ?? ''));
    if ($gEmail !== '') {
        $dRows[] = ['Email', '<a href="mailto:' . email_esc($gEmail) . '" style="color:#1B2A34;">' . email_esc($gEmail) . '</a>'];
    }
    $gPhone = trim((string) ($e['phone'] ?? ''));
    if ($gPhone !== '') {
        $tel = preg_replace('/[^0-9+]/', '', $gPhone);
        $dRows[] = ['Phone', '<a href="tel:' . email_esc($tel) . '" style="color:#1B2A34;">' . email_esc($gPhone) . '</a>'];
    }
    if ($addr !== '') {
        $dRows[] = ['Address', '<a href="' . email_esc(email_maplink($addr)) . '" style="color:#1B2A34;">' . email_esc($addr) . '</a>'];
    }
    if ($times !== '') {
        $dRows[] = ['Times', email_esc($times)];
    }
    if ($party !== '') {
        $dRows[] = ['Party', email_esc($party)];
    }
    if ($priceLine !== '') {
        $dRows[] = ['Est. price', email_esc($priceLine)];
    }

    $inner =
        email_h('New enquiry') .
        email_p(
            '<strong style="color:#1B2A34;">' .
                email_esc($e['name'] ?? '') .
                '</strong> would like to stay at <strong style="color:#1B2A34;">' .
                email_esc($prop) .
                '</strong>.',
        ) .
        ($prior > 0
            ? email_note('★ Returning guest — ' . $prior . ' completed stay' . ($prior === 1 ? '' : 's') . ' before this.')
            : '') .
        email_p(
            email_esc(email_date($e['check_in'] ?? '') . ' to ' . email_date($e['check_out'] ?? '')) . ' &middot; ' . email_esc($party),
            true,
        ) .
        ($dRows ? email_rows($dRows) : '') .
        (!empty($e['message']) ? email_note(email_esc($e['message'])) : '') .
        // A DECISION IS TWO BUTTONS. Approve was a 44px button and Decline a bare
        // grey inline link inside a muted paragraph — so of the two outcomes this
        // email exists to offer, one was an affordance and the other was a footnote
        // the size of the small print, on a phone. They are a pair now: the same tap
        // target, the primary weight still on the one that makes money.
        email_btn($e['approve_url'], 'Review & approve') .
        email_btn2($e['decline_url'], 'Decline this enquiry') .
        email_footnote('Each link opens a confirmation page first &mdash; nothing happens until you press the button there.');
    $html = email_shell('You promised a reply by the end of the next day. ' . $party . ' · ' . $prop . '.', $inner);
    return send_people('enquiry', $subject, $text, $html);
}

// One-line summary of a cottage's cancellation policy (mirrors the JS
// CANCELLATION_POLICIES map + the '<prop>-cancellation-policy' content key) —
// the booking Terms promise this appears in the confirmation email.
function cancellation_policy_line($propKey)
{
    $policies = [
        'flexible' => ['Flexible', 'full refund at least 1 day before check-in; partial refund within 1 day of check-in'],
        'moderate' => ['Moderate', 'full refund at least 5 days before check-in; partial refund within 5 days of check-in'],
        // Kept word-for-word in step with CANCELLATION_POLICIES in app.js — the
        // cottage page, the terms and this email line are the same promise.
        'limited' => ['Limited', 'full refund at least 14 days before check-in; partial refund 7–14 days before check-in; no refund within 7 days of check-in'],
    ];
    $key = function_exists('content_value') ? content_value($propKey . '-cancellation-policy') : '';
    $pol = $policies[$key] ?? $policies['flexible'];
    return 'Cancellation policy — ' . $pol[0] . ': ' . $pol[1] . '. Full details in our booking terms.';
}

function send_booking_emails($b)
{
    $out = [
        'guest' => ['ok' => false, 'error' => 'not attempted'],
        'owner' => ['ok' => false, 'error' => 'not attempted'],
    ];
    if (!defined('MAIL_ENABLED') || !MAIL_ENABLED) {
        $out['guest']['error'] = $out['owner']['error'] = 'Mail disabled';
        return $out;
    }

    $money = fn($n) => '£' . number_format((float) $n, 2);
    $nightsTxt = $b['nights'] . ' night' . ((int) $b['nights'] === 1 ? '' : 's');
    $party =
        $b['adults'] .
        ' adult' .
        ((int) $b['adults'] === 1 ? '' : 's') .
        ((int) $b['children'] > 0 ? ', ' . $b['children'] . ' child' . ((int) $b['children'] === 1 ? '' : 'ren') : '');

    // Property accent colour (matches the site's calendar/tag colours)
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $paymentLabel = ucfirst($b['payment'] ?? 'unpaid');
    $paymentColor = ($b['payment'] ?? 'unpaid') === 'paid' ? '#29712D' : '#BC2626';
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');

    // ---- Guest confirmation ----
    if (!empty($b['skip_guest'])) {
        $out['guest']['error'] = 'Not sent (switched off)';
    }
    if (!empty($b['email']) && empty($b['skip_guest'])) {
        // THE SUBJECT SAYS WHICH STAY AND WHEN, so it can be found again in a search for
        // "Jollyboat" or "Sep" — not just that "a booking" happened.
        $subject = "You’re booked: {$b['prop_name']}, " . email_range($b['check_in'], $b['check_out']);

        // Plain-text fallback (clients that block HTML still get this)
        $body = "You’re booked, " . first_name($b['name'], 'Guest') . ".\n\n";
        $body .= "{$b['prop_name']} is yours from " . email_date($b['check_in']) . ".\n\n";
        $body .= "Booking reference: {$b['ref']}\n";
        $body .= 'Check in:  ' . email_date($b['check_in']) . ' from ' . email_time($b['check_in_time']) . "\n";
        $body .= 'Check out: ' . email_date($b['check_out']) . ' by ' . email_time($b['check_out_time']) . "\n";
        $body .= "Party: {$party}\n";
        $body .= "Payment: {$paymentLabel}\n";
        $body .= "Address: {$b['address']}\n";
        if (trim((string) $b['address']) !== '') {
            $body .= 'Directions: ' . email_maplink($b['address']) . "\n";
        }
        $body .= "\n";
        // The refundable deposit is charged with the first payment & refunded after
        // the stay, so it's part of the total the guest pays until then.
        $depAmt = round((float) ($b['damages_deposit'] ?? 0), 2);
        $grandTotal = round((float) $b['total'] + $depAmt, 2);
        // A CUSTOM PRICE IS ONE LINE, SAID SO. With a price_override / agreed
        // enquiry price, `total` is the agreed figure while per_night/nightly/
        // tx_fee are still the standard snapshot — printing them alongside it
        // sent "£130.00 × 7 nights: £910.00 … Total £750.00" to a guest, lines
        // that cannot add up to their own total. booking_price_is_custom is the
        // one definition of that test (db.php).
        $customPrice = booking_price_is_custom($b['nightly'], $b['tx_fee'], $b['total']);
        if ($customPrice) {
            $body .= "Agreed price for your stay ({$nightsTxt}): " . $money($b['total']) . "\n";
        } else {
            $body .= $money($b['per_night']) . " x {$nightsTxt}: " . $money($b['nightly']) . "\n";
            $body .= "Transaction fee ({$b['tx_pct']}%): " . $money($b['tx_fee']) . "\n";
        }
        if ($depAmt > 0) {
            $body .= 'Refundable damages deposit: ' . $money($depAmt) . "\n";
        }
        $body .= 'Total: ' . $money($grandTotal) . ($depAmt > 0 ? ' (incl. deposit)' : '') . "\n";
        if ($depAmt > 0) {
            $body .=
                'Includes a refundable security deposit of ' .
                $money($depAmt) .
                ", charged together with your first payment and refunded in full after checkout (provided there's no damage).\n";
        }
        $body .= cancellation_policy_line($b['prop_key'] ?? '') . "\n";
        // Payment state (only once something has been paid) so a re-sent
        // confirmation reflects a recorded deposit/payment.
        $paidNow = round((float) ($b['paid_so_far'] ?? 0), 2);
        $balNow = round((float) ($b['balance_due'] ?? 0), 2);
        // THE SCHEDULE, NOT JUST THE SUM. The guest was told what was outstanding
        // and never by when — so a plan the owner had agreed with them lived only
        // in the back office. The date is the booking's own (custom date, else
        // check-in minus the window), so this can never quote a different day
        // from the chaser that follows it.
        $dueByLine = '';
        $dueByHtml = '';
        if ($balNow > 0.001 && !empty($b['balance_due_date'])) {
            $dueByLine = ' — due by ' . email_date((string) $b['balance_due_date']);
            // The HTML twin of $dueByLine for the priceBox's balance row (email_date
            // returns a formatted weekday date, not user input, so it needs no escape).
            $dueByHtml = '<br><span style="font-size:12px;font-weight:400;color:' . email_muted_ink() . ';">due by ' . email_date((string) $b['balance_due_date']) . '</span>';
        }
        if ($paidNow > 0) {
            $body .= "\nPaid so far: " . $money($paidNow) . "\n";
            $body .= ($balNow > 0.001 ? 'Balance remaining: ' . $money($balNow) . $dueByLine : 'Paid in full — thank you!') . "\n";
        } elseif ($balNow > 0.001 && $dueByLine !== '') {
            // Nothing paid yet: still say when the money is wanted, because this
            // is the email that lands before any of it has been asked for.
            $body .= "\nBalance of " . $money($balNow) . $dueByLine . ".\n";
        }
        if ($balNow > 0.001 && !empty($b['id']) && payment_rail($b) === 'card' && function_exists('square_enabled') && square_enabled() && function_exists('pay_token')) {
            $body .= "\nPay the balance: " . site_base_url() . 'index.html?pay=' . pay_token((int) $b['id']) . '&b=' . (int) $b['id'] . "\n";
        }
        // WHAT HAPPENS NEXT — the same steps the designed email shows, stated only where
        // the system keeps the promise (the arrival email really does go out a few days
        // before, the deposit really is returned after checkout).
        $nextSteps = [];
        if ($paidNow > 0) {
            $nextSteps[] = [$balNow > 0.001 ? 'Payment received' : 'Paid in full', $money($paidNow) . ' — thank you', true];
        }
        if ($balNow > 0.001) {
            $nextSteps[] = ['Balance of ' . $money($balNow), !empty($b['balance_due_date']) ? 'due by ' . email_date((string) $b['balance_due_date']) : 'still to come', false];
        }
        $nextSteps[] = ['Arrival details', 'directions and entry information, emailed a few days before you arrive', false];
        $nextSteps[] = ['Your stay', email_range($b['check_in'], $b['check_out']), false];
        if ($depAmt > 0) {
            $nextSteps[] = ['Your ' . $money($depAmt) . ' deposit', 'returned after checkout, provided there’s no damage', false];
        }
        $calUrls = email_cal_urls($b);
        $body .= "\nAdd to your calendar:\n  Google:  " . $calUrls['google'] . "\n  Outlook: " . $calUrls['outlook'] . "\n  Apple:   open the attached invite\n";
        $body .= "\nWHAT HAPPENS NEXT\n";
        foreach ($nextSteps as $st) {
            $body .= ($st[2] ? '[x] ' : '[ ] ') . $st[0] . ($st[1] !== '' ? ' — ' . $st[1] : '') . "\n";
        }
        $body .= "\nYour booking page: " . site_base_url() . "index.html?open=stay\n";
        if (!empty($b['invoice_url'])) {
            $body .= "\nView or download your invoice: " . $b['invoice_url'] . "\n";
        }
        if (!empty($b['guest_reg_url'])) {
            $body .= "\nBefore you arrive, please add your guest details (a UK legal requirement — full name & nationality of everyone 16+): " . $b['guest_reg_url'] . "\n";
        }
        $body .= "\n";
        $body .= "If you have any questions, just reply to this email.\nCottage Holidays Blakeney\n";

        // The pay button + a way back to the booking. Both suppressed when there is
        // nothing outstanding, and the card button also when the guest is not on the card
        // rail or Square is off — an email must never offer a card link to a guest whose
        // money the owner collects by hand.
        $stayUrl = site_base_url() . 'index.html?open=stay';
        $payCta = '';
        if (
            $balNow > 0.001 &&
            !empty($b['id']) &&
            payment_rail($b) === 'card' &&
            function_exists('square_enabled') &&
            square_enabled() &&
            function_exists('pay_token')
        ) {
            // House accent + ink, NOT the per-cottage accent: a button carries
            // WORDS, and the cottage colour measured below AA at 15px (e.g. dark
            // ink on Pimpernel's purple, 2.10:1). The cottage colour stays a FILL
            // where it is one (the shell's bar, email_h's swatch). Same rule the
            // enquiry nudges follow.
            $payCta = email_btn(
                site_base_url() . 'index.html?pay=' . pay_token((int) $b['id']) . '&b=' . (int) $b['id'],
                'Pay the balance',
            );
        }
        $payCta .= email_btn2($stayUrl, 'View my booking');
        // HTML version — "Midnight Glass" shell + the booking "stay ticket".
        // NB the payment colour is NOT re-derived here. It was, with the greens and
        // ambers from the dark UPCOMING chip below — which are right on #22321f and
        // were then used as text on a WHITE row, measuring 2.23:1 for the word
        // "Unpaid". The pair derived for the text half twelve lines up is the
        // correct one and is still in scope, so this shadow is simply gone.
        $sans = email_sans();
        $serif = email_serif();
        $statusBadge = email_cap('ok', 'Confirmed');
        $pr = fn($l, $v) => '<tr><td style="padding:8px 0;font-family:' .
            $sans .
            ';font-size:15px;color:#1B2A34;">' .
            $l .
            '</td><td align="right" style="padding:8px 0;font-family:' .
            $sans .
            ';font-size:15px;color:#1B2A34;">' .
            $v .
            '</td></tr>';
        // The modern money anatomy (the invoice's): price lines on hairlines, the
        // Total in the grotesque above a heavier rule — no tinted panel, so the
        // one tint an email keeps (email_note) stays the single shout.
        $priceBox =
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 4px;"><tr><td style="border-top:1px solid #E2E3E3;padding-top:4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' .
            // Same branch as the plain-text body above — a custom price is one
            // coherent line, not standard-rate maths beside a total it can't reach.
            ($customPrice
                ? $pr('Agreed price for your stay <span style="color:' . email_muted_ink() . ';">(' . $nightsTxt . ')</span>', $money($b['total']))
                : $pr($money($b['per_night']) . ' &times; ' . $nightsTxt, $money($b['nightly'])) .
                  $pr('Transaction fee (' . $esc($b['tx_pct']) . '%)', $money($b['tx_fee']))) .
            ($depAmt > 0 ? $pr('Refundable damages deposit', $money($depAmt)) : '') .
            '<tr><td colspan="2" class="em-r2" style="border-top:2px solid #C7CACA;font-size:0;line-height:0;">&nbsp;</td></tr>' .
            '<tr><td style="padding:10px 0 4px;font-family:' .
            $sans .
            ';font-size:15px;font-weight:700;color:#1B2A34;">Total' . ($depAmt > 0 ? ' <span style="font-size:12px;font-weight:400;color:' . email_muted_ink() . ';">(incl. deposit)</span>' : '') . '</td><td align="right" style="padding:10px 0 4px;font-family:' .
            $sans .
            ';font-size:17px;font-weight:700;letter-spacing:-0.02em;font-variant-numeric:tabular-nums;color:#1B2A34;">' .
            $money($grandTotal) .
            '</td></tr>' .
            // (the refundable-deposit sentence is a FOOTNOTE under this box, not a row
            // inside it — as a label/value pair one sentence wrapped 2+2 lines on a
            // phone and read as a label beside a value)
            // Payment state — shown only once a payment is recorded, so a re-sent
            // confirmation reflects the deposit/balance. The due-by DATE rides the
            // balance row here too, not only in the plain-text half: a guest who
            // reads the HTML (nearly all) was shown a balance with no deadline.
            ($paidNow > 0
                ? '<tr><td colspan="2" style="border-top:1px solid #E2E3E3;font-size:0;line-height:0;">&nbsp;</td></tr>' .
                    $pr('Paid so far', '<span style="color:#29712D;font-weight:600;">' . $money($paidNow) . '</span>') .
                    ($balNow > 0.001
                        ? $pr(
                            '<strong>Balance remaining</strong>',
                            '<strong>' . $money($balNow) . '</strong>' . $dueByHtml,
                        )
                        : $pr('<strong style="color:#29712D;">Paid in full</strong>', '<strong style="color:#29712D;">&#10003;</strong>'))
                : ($balNow > 0.001
                    ? '<tr><td colspan="2" style="border-top:1px solid #E2E3E3;font-size:0;line-height:0;">&nbsp;</td></tr>' .
                        $pr('<strong>Balance</strong>', '<strong>' . $money($balNow) . '</strong>' . $dueByHtml)
                    : '')) .
            '</table></td></tr></table>';
        $inner =
            email_eyebrow($accent, $b['prop_name'] . ' · ' . email_range($b['check_in'], $b['check_out'])) . email_h('You’re booked, ' . first_name($b['name'], 'Guest') . '.', $accent) .
            '<div style="font-family:' .
            $sans .
            ';font-size:12px;font-weight:600;color:' . email_muted_ink() . ';margin:2px 0 6px;">Booking ref ' .
            $esc($b['ref']) .
            ' &nbsp;&middot;&nbsp; ' .
            $statusBadge .
            '</div>' .
            email_p('<strong style="color:#1B2A34;">' . $esc($b['prop_name']) . '</strong> is yours from ' . email_date($b['check_in']) . '. Here are the details:') .
            email_dates($b['check_in'], $b['check_in_time'], $b['check_out'], $b['check_out_time']) .
            email_cal_links($b) .
            // (Arrive and Leave are the dates block above — said once, not twice.)
            email_rows([
                ['Party', $esc($party)],
                ['Payment', email_cap(($b['payment'] ?? 'unpaid') === 'paid' ? 'ok' : (($b['payment'] ?? 'unpaid') === 'deposit' ? 'warn' : 'bad'), ($b['payment'] ?? 'unpaid') === 'paid' ? 'Paid in full' : (($b['payment'] ?? 'unpaid') === 'deposit' ? 'Deposit paid' : 'Not paid yet'))],
            ]) .
            // An address is its own block with a Maps link, not a value squeezed into
            // the 40/60 grid — where a long one wrapped to three right-aligned lines.
            email_address_block($b['address'] ?? '') .
            $priceBox .
            // A STATED BALANCE GETS A WAY TO PAY IT. This email carried no link at all
            // while telling the guest what they still owed, and it is the one they keep
            // and re-open. The pay link is the same login-free token the chaser uses, so
            // no new way in; it is offered only when there IS something to pay and the
            // card rail is the guest's (an owner-arranged stay is settled by hand — the
            // bookingOwnerArranged rule).
            $payCta .
            email_caption('What happens next') .
            email_timeline($nextSteps) .
            (!empty($b['invoice_url']) ? email_btn2($b['invoice_url'], 'View your invoice') : '') .
            (!empty($b['guest_reg_url']) ? email_p('<strong>Before you arrive:</strong> UK law asks us to record the name &amp; nationality of everyone staying who is 16 or over. Please add your guest details — it only takes a minute.', true) . email_btn($b['guest_reg_url'], 'Add your guest details') : '') .
            ($depAmt > 0
                ? email_footnote(
                    'The ' . $money($depAmt) .
                        ' deposit is refundable — charged with your first payment and returned in full after checkout, provided there&rsquo;s no damage.',
                )
                : '') .
            email_footnote(htmlspecialchars(cancellation_policy_line($b['prop_key'] ?? ''), ENT_QUOTES, 'UTF-8')) .
            email_p('Any questions? Just reply to this email — we look forward to welcoming you.', true);
        // THE PREVIEW FINISHES THE THOUGHT the subject starts — the ~90 inbox
        // characters carry the facts the subject doesn't, instead of restating it.
        $html = email_shell(
            ($balNow > 0.001
                ? ($paidNow > 0 ? $money($paidNow) . ' paid; ' . $money($balNow) . ' still to come' . $dueByLine . '.' : $money($balNow) . ' to pay' . $dueByLine . '.')
                : 'Paid in full — nothing more to pay.') .
                ' Add the dates to your calendar.',
            $inner,
            $accent,
            ['photo' => email_photo_band(email_prop_photo($b['prop_key'] ?? ''), (string) ($b['prop_name'] ?? ''))],
        );

        // Attach a calendar invite (.ics) so the guest can add the stay in one tap.
        $ics = build_booking_ics($b);
        $atts = $ics
            ? [['filename' => 'booking-' . ($b['ref'] ?? 'CHB') . '.ics', 'mime' => 'text/calendar', 'content' => $ics]]
            : [];
        // Approval deliberately never breaks on an email problem — which made a
        // failed confirmation silently unrecoverable. It queues now.
        $out['guest'] = smtp_send_reliable('confirmation', $b['email'], $b['name'], $subject, $body, $html, $atts);
    } else {
        $out['guest']['error'] = 'No guest email on file';
    }

    // ---- Owner notification ----
    // Skipped on a payment re-send (skip_owner) so the owner isn't re-pinged with
    // "new booking" each time a payment is recorded.
    if (empty($b['skip_owner']) && owner_recipients('booking')) {
        // WHO, WHERE, WHEN, and the money state — what the owner wants from a lock screen.
        $subject = 'New booking: ' . ($b['name'] ?: 'A guest') . ", {$b['prop_name']}, " . email_range($b['check_in'], $b['check_out']) .
            (round((float) ($b['paid_so_far'] ?? 0), 2) > 0 ? ' (£' . number_format((float) $b['paid_so_far'], 2) . ' paid)' : '');
        $body = "A booking has just been confirmed.\n\n";
        $body .= "Reference: {$b['ref']}\n";
        $body .= "Property: {$b['prop_name']}\n";
        $body .= "Guest: {$b['name']}\n";
        $body .= 'Email: ' . ($b['email'] ?: '—') . "\n";
        $body .= 'Phone: ' . ($b['phone'] ?? '—') . "\n";
        $body .= 'Check in:  ' . email_date($b['check_in']) . ' (' . email_time($b['check_in_time']) . ")\n";
        $body .= 'Check out: ' . email_date($b['check_out']) . ' (' . email_time($b['check_out_time']) . ")\n";
        $body .= "Stay: {$nightsTxt}\n";
        $body .= "Guests: {$party}\n";
        $ownerDep = round((float) ($b['damages_deposit'] ?? 0), 2);
        $ownerTotal = $money(round((float) $b['total'] + $ownerDep, 2));
        $body .= 'Total: ' . $ownerTotal . ($ownerDep > 0 ? ' (incl. deposit)' : '') . "\n";
        $hubUrl = !empty($b['id']) ? site_base_url() . '?open=booking-' . (int) $b['id'] : '';
        if ($hubUrl !== '') {
            $body .= "\nOpen the booking: {$hubUrl}\n";
        }

        // AN HTML HALF, WITH THE CONTACTS TAPPABLE AND THE BOOKING ONE TAP AWAY.
        // This notification was plain text only — the sole email in the file with
        // no HTML — so the guest's phone number was characters to be copied by
        // hand, the guest's email likewise, and the booking it announces could
        // only be found by opening the app and searching for the name. The owner
        // reads this on a phone the moment it arrives, which is exactly when
        // ringing the guest or opening the record is what they want to do.
        // (`?open=booking-<id>` is the existing notification-deep-link vocabulary
        // — maybeHandleNotificationOpen in app.js routes it through the facade
        // stubs, so it works arriving cold.)
        $oRows = [['Reference', email_esc((string) $b['ref'])], ['Cottage', email_esc((string) $b['prop_name'])]];
        $oGuestEmail = trim((string) ($b['email'] ?? ''));
        if ($oGuestEmail !== '') {
            $oRows[] = ['Email', '<a href="mailto:' . email_esc($oGuestEmail) . '" style="color:#1B2A34;">' . email_esc($oGuestEmail) . '</a>'];
        }
        $oGuestPhone = trim((string) ($b['phone'] ?? ''));
        if ($oGuestPhone !== '') {
            $oRows[] = [
                'Phone',
                '<a href="tel:' . email_esc(preg_replace('/[^0-9+]/', '', $oGuestPhone)) . '" style="color:#1B2A34;">' . email_esc($oGuestPhone) . '</a>',
            ];
        }
        $oRows[] = ['Arrive', '<strong>' . email_esc(email_date($b['check_in'])) . '</strong>' . (email_time($b['check_in_time']) !== '' ? ' &middot; ' . email_esc(email_time($b['check_in_time'])) : '')];
        $oRows[] = ['Leave', '<strong>' . email_esc(email_date($b['check_out'])) . '</strong>' . (email_time($b['check_out_time']) !== '' ? ' &middot; ' . email_esc(email_time($b['check_out_time'])) : '')];
        $oRows[] = ['Stay', email_esc($nightsTxt)];
        $oRows[] = ['Guests', email_esc($party)];
        $oRows[] = ['Total', '<strong>' . email_esc($ownerTotal . ($ownerDep > 0 ? ' incl. deposit' : '')) . '</strong>'];
        $oInner =
            email_h('New confirmed booking', $accent) .
            email_p(
                '<strong style="color:#1B2A34;">' . email_esc((string) $b['name']) . '</strong> is confirmed at <strong style="color:#1B2A34;">' .
                    email_esc((string) $b['prop_name']) . '</strong>.',
            ) .
            email_rows($oRows) .
            ($hubUrl !== '' ? email_btn($hubUrl, 'Open the booking') : '');
        $oHtml = email_shell(
            $b['name'] . ' — ' . $b['prop_name'] . ', ' . email_date($b['check_in'], false),
            $oInner,
            $accent,
        );

        if (!empty($b['defer_owner'])) {
            // The caller only needs the GUEST result (that's what the UI shows);
            // the owner copy can go out after the response has been flushed, so
            // the save isn't kept waiting on a second SMTP handshake.
            mail_after_response(function () use ($subject, $body, $oHtml) {
                send_people('booking', $subject, $body, $oHtml);
            });
            $out['owner'] = ['ok' => true, 'deferred' => true];
        } else {
            $out['owner'] = send_people('booking', $subject, $body, $oHtml);
        }
    }

    return $out;
}

// ------------------------------------------------------------------
//  Pre-arrival "arrival info" email: sent a few days before check-in
//  (via pre-arrival.php cron) or manually from the back office.
//  $b: prop_key, prop_name, guest name/email, check_in, check_out,
//      check_in_time, address, info (owner-written arrival details).
// ------------------------------------------------------------------
// THE ARRIVAL EMAIL'S OPENING SENTENCE, stated once. It is the one part the
// owner edits when arrival-review is on (bookings.php send_arrival takes a
// `note`), so the composer must prefill from the SAME function the email
// renders — otherwise the box shows one thing and the guest receives another.
// Plain text in, escaped at the boundary by send_arrival_email.
function arrival_default_message($name, $prop)
{
    return 'Hello ' . $name . ' — everything you need for ' . $prop . ' is below. We look forward to seeing you.';
}
// THE ARRIVAL EMAIL, COMPOSED — pure of the transport, so the REVIEW screen can
// preview the real thing. It could not before: the composer's preview went
// through build_enquiry_reply_email, which wraps whatever is in the box in the
// enquiry-reply shell AND opens with its own "Hello <name>," — so the owner was
// shown a different email from the one that sends, greeting the guest twice
// (the reviewed message already opens with the house sentence). A screen that
// says "this is exactly what your guest will receive" has to be able to build
// exactly that. Returns ['subject','text','html'].
function arrival_email_body($b)
{
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $name = first_name($b['name'], 'Guest');
    // Derive the cottage name rather than depending on the caller to pass prop_name —
    // prop_display() is right here and 'your cottage' is a poor thing to send someone.
    $prop = trim((string) ($b['prop_name'] ?? '')) !== ''
        ? $b['prop_name']
        : (prop_display($b['prop_key'] ?? '')['name'] ?: 'your cottage');
    $inDate = email_date($b['check_in']);
    $outDate = !empty($b['check_out']) ? email_date($b['check_out']) : '';
    $time = email_time($b['check_in_time'] ?: '15:00');
    $outTime = email_time($b['check_out_time'] ?: '10:00');
    $addr = trim($b['address'] ?? '');
    $phone = email_phone();
    // The reviewed message. Absent (review off, or sent as-is) → the house
    // sentence below, so nothing changes for the automatic path.
    $note = trim((string) ($b['note'] ?? ''));
    // THE INSTRUCTION AND THE WAY TO FOLLOW IT TRAVEL TOGETHER. This email said "log in
    // to your account on our website and open My Bookings" and carried NO LINK — read on
    // a phone on the way to Norfolk, with nothing to tap. The entry code itself is still
    // never emailed (see send_arrival_for_booking); the guest reveals it in-app once
    // they're there. What changed is that the app is now one tap away.
    $stayUrl = site_base_url() . 'index.html?open=stay';
    // The cottage's own house rules, resolved by the CALLER (arrival_email_payload)
    // so this composer stays pure and driveable with no database.
    $rules = [];
    foreach (is_array($b['rules'] ?? null) ? $b['rules'] : [] as $r) {
        if (is_scalar($r) && trim((string) $r) !== '') {
            $rules[] = trim((string) $r);
        }
    }

    $subject = 'See you ' . email_date($b['check_in'], false) . ": directions and everything for {$prop}";
    $text =
        ($note !== '' ? $note . "\n\n" : "Hello {$name},\n\n") .
        "Arrive: {$inDate}, any time from {$time}\n" .
        ($outDate !== '' ? "Leave:  {$outDate}, by {$outTime}\n" : '') .
        "\n" .
        ($addr !== '' ? "Address:\n{$addr}\nDirections: " . email_maplink($addr) . "\n\n" : '') .
        "Your entry details appear on your booking page once you're here:\n{$stayUrl}\n\n" .
        ($rules ? "A few house rules:\n" . implode("\n", array_map(fn($r) => '- ' . $r, $rules)) . "\n\n" : '') .
        ($phone !== '' ? "Trouble getting in, or running late? Call {$phone} — or just reply to this email.\n\n" : "Running late or stuck? Just reply to this email.\n\n") .
        "We look forward to seeing you.\n\nCottage Holidays Blakeney";

    // THE FIRST THING ON THE DAY IS "HOW DO I GET THERE", so directions lead as the one
    // filled button; the booking page is the quiet second. Arrive/Leave is the dates pair
    // (check-out is the second thing guests forget, so it stays).
    $inner =
        email_eyebrow($accent, $prop . ' · ' . email_range($b['check_in'], $b['check_out'] ?? '')) . email_h('See you ' . date('l', strtotime((string) $b['check_in'])) . ', ' . $name . '.', $accent) .
        // The owner's own words when they reviewed it, else the house sentence.
        // email_p expects PRE-ESCAPED HTML (the asymmetry in CLAUDE.md), and a
        // reviewed note is free text typed by a person — so it is escaped here
        // and its line breaks become <br>, never raw markup from a text box.
        email_p($note !== ''
            ? nl2br(email_esc($note))
            : 'Hello ' . email_esc($name) . ' — everything you need for <strong>' .
                email_esc($prop) . '</strong> is below. We look forward to seeing you.') .
        ($addr !== '' ? email_btn(email_maplink($addr), 'Directions to ' . $prop) : '') .
        email_dates($b['check_in'], $b['check_in_time'] ?: '15:00', $outDate !== '' ? $b['check_out'] : $b['check_in'], $outDate !== '' ? ($b['check_out_time'] ?: '10:00') : '') .
        email_address_block($addr) .
        email_note(
            '<strong style="color:#1B2A34;">Your entry details</strong><br>They appear on your booking page once you&rsquo;re here &mdash; we never email a door code. Tap below and open <strong style="color:#1B2A34;">Your stay</strong>.',
            $accent,
        ) .
        ($addr !== '' ? email_btn2($stayUrl, 'Open my booking') : email_btn($stayUrl, 'Open my booking')) .
        // THE HOUSE RULES, and only the owner's OWN. The arrive/leave rows above
        // already state the times, so repeating them as "Check-in after 3pm"
        // would say one fact twice in one email — the guest's stay screen leads
        // with them because nothing else there does. A rule is PROSE, so this is
        // email_note (the design system's callout), never email_rows, whose
        // right-rail 14px bold is for a label and a value. Free text typed by a
        // person, so escaped here (email_note expects PRE-ESCAPED HTML). Nothing
        // saved → no heading, no empty block.
        // NOT email_note. The tinted accent callout directly above the button is
        // "your entry details" — the one thing this email needs the guest to act
        // on — and a second identical block under it makes two shouts where the
        // design system means one. Rules are REFERENCE: read once, observed for a
        // week. So they sit in the flow as prose.
        ($rules
            // Body ink, NOT email_p's muted variant: these are the owner's own
            // terms, not a footnote about them.
            ? email_p('<strong style="color:#1B2A34;">A few house rules</strong><br>' .
                implode('<br>', array_map(fn($r) => '&bull;&nbsp; ' . email_esc($r), $rules)))
            : '') .
        email_footnote(
            $phone !== ''
                ? 'Trouble getting in, or running late? Call <a href="tel:' .
                    email_esc(preg_replace('/\s+/', '', $phone)) .
                    '" style="color:#965C35;">' . email_esc($phone) . '</a> — or just reply to this email.'
                : 'Running late or stuck? Just reply to this email and we&rsquo;ll help.',
        );
    $html = email_shell(
        'Check-in from ' . $time . '. Directions are the first button; your entry details appear in your booking on the day.',
        $inner,
        $accent,
        ['photo' => email_photo_band((string) ($b['photo'] ?? ''), $prop)],
    );

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}
function send_arrival_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    // arrival_email_payload() resolves the photo for the real path; a caller
    // handing a bare payload (the owner's sample sender) gets the same band.
    $b['photo'] = (string) ($b['photo'] ?? email_prop_photo($b['prop_key'] ?? ''));
    $m = arrival_email_body($b);
    return smtp_send($b['email'], first_name($b['name'], 'Guest'), $m['subject'], $m['text'], $m['html']);
}

// Passwordless sign-in link. $g: a guest row (needs name, email). $url: the
// magic link from auth.php (carries id + issue-time + HMAC, expires in 30 min).
function send_magic_link_email($g, $url, $purpose = 'signin', $code = '')
{
    // A CODE rides beside the link (the code-first sign-in): an iPhone opens an
    // emailed link in Safari rather than the installed app, so the guest needs
    // something to TYPE where they are. 'join' is a new guest — a code and no link.
    if ($code !== '') {
        return send_guest_code_email($g, $url, $code, $purpose === 'join');
    }
    // 'reset': the OWNER sent it from Manage → Guests so the guest can choose a
    // new password themselves — same signed, single-use, 30-minute link.
    $reset = $purpose === 'reset';
    if (empty($g['email'])) {
        return ['ok' => false, 'error' => 'No email'];
    }
    $accent = '#C6885E';
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($g['name'], 'there');

    $subject = $reset ? 'Choose a new password — Cottage Holidays Blakeney' : 'Your sign-in link — Cottage Holidays Blakeney';
    $text =
        "Hello {$name},\n\n" .
        ($reset ? "Here is your link to choose a new password for your Cottage Holidays Blakeney account:\n" : "Here is your secure sign-in link for Cottage Holidays Blakeney:\n") .
        $url .
        "\n\n" .
        "It works once and expires in 30 minutes — ask for a fresh one any time.\n" .
        "If you didn't request it, you can safely ignore this email.\n\n" .
        'Cottage Holidays Blakeney';

    // THE LINK ITSELF IS PRINTED, not only wrapped in a button. A sign-in email is
    // the one email a guest is most likely to open on a DIFFERENT device from the
    // one they want to sign in on (asked for on a laptop, read on a phone), and it
    // is also the one most likely to be read in a client that strips the VML
    // button. A tappable button with no visible URL beside it is then a dead end
    // with nothing to copy. The URL is deliberately printed in full rather than
    // truncated: a shortened sign-in link cannot be pasted, which defeats the point.
    $inner =
        email_h($reset ? 'Choose a new password' : 'Sign in to your account', $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ($reset ? ', tap the button below to choose a new password for your Cottage Holidays Blakeney account.' : ', tap the button below to sign in to your Cottage Holidays Blakeney account — no password needed.'),
        ) .
        email_btn($url, $reset ? 'Choose a password' : 'Sign me in', $accent) .
        email_footnote(
            'Button not working, or reading this on another device? Copy this link into your browser:<br>' .
                // A LINK STYLED AS A LINK, in a token ink. Left as text, iOS Mail
                // auto-links it and paints it system blue; and a hand-picked grey
                // here once measured 3.10:1 on the dark card (an off-token ink gets
                // no dark twin).
                '<a href="' . $esc($url) . '" style="color:' . email_accent_ink() . ';text-decoration:underline;word-break:break-all;">' . $esc($url) . '</a>',
        ) .
        // WHAT THE GUEST NEEDS TO KNOW BEFORE THEY TAP: that it is single-use. A
        // link that silently stops working on the second tap reads as broken —
        // saying so up front turns "it didn't work" into "I need a fresh one",
        // which the same sentence tells them how to get.
        email_footnote(
            'It works once and expires in 30 minutes — if it has gone stale, just ask for a new one. ' .
                'If you didn&rsquo;t request this, you can safely ignore this email.',
        );
    $html = email_shell($reset ? 'Choose a new password — the link works once, for 30 minutes' : 'Your secure sign-in link — works once, expires in 30 minutes', $inner, $accent);

    return smtp_send($g['email'], $name, $subject, $text, $html);
}

// The sign-in CODE email. Pure composer + sender, like every template here.
function guest_code_email_body($name, $url, $code, $isNew)
{
    $accent = '#C6885E';
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $pretty = substr($code, 0, 3) . ' ' . substr($code, 3);
    $subject = 'Your code is ' . $pretty . ' — Cottage Holidays Blakeney';
    $text =
        ($isNew ? "Hello,\n\nHere is your code to create your Cottage Holidays Blakeney account:\n\n" : "Hello {$name},\n\nHere is your code to sign in to Cottage Holidays Blakeney:\n\n") .
        $pretty . "\n\n" .
        ($url !== '' ? "Or tap this link to sign in on this device:\n{$url}\n\n" : '') .
        "It works once and expires in 30 minutes.\nIf you didn't ask for it, you can safely ignore this email.\n\nCottage Holidays Blakeney";
    $inner =
        email_h($isNew ? 'Your code to create your account' : 'Your sign-in code', $accent) .
        email_p($isNew ? 'Type this code where you asked for it:' : 'Hello ' . $esc($name) . ', type this code where you asked for it:') .
        email_code('Your code', $code, 'Works once, for 30 minutes.') .
        ($url !== '' ? email_btn2($url, 'Or sign me in on this device') .
            email_footnote('Copy this link into your browser if the button doesn&rsquo;t work:<br><a href="' . $esc($url) . '" style="color:' . email_accent_ink() . ';text-decoration:underline;word-break:break-all;">' . $esc($url) . '</a>') : '') .
        email_footnote('If you didn&rsquo;t ask for this, you can safely ignore this email.');
    $html = email_shell('Your code is ' . $pretty . ' — it works once, for 30 minutes', $inner, $accent);
    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}
function send_guest_code_email($g, $url, $code, $isNew)
{
    if (empty($g['email'])) {
        return ['ok' => false, 'error' => 'No email'];
    }
    $m = guest_code_email_body(first_name($g['name'] ?? '', 'there'), $url, $code, $isNew);
    return smtp_send($g['email'], first_name($g['name'] ?? '', ''), $m['subject'], $m['text'], $m['html']);
}

// THE COTTAGE'S OWN PAGE. The two "come back" emails both sent the guest to the
// HOMEPAGE — so an email naming Jollyboat, carrying Jollyboat's photo and its
// accent, landed on a page listing three cottages and asked them to find it
// again. cottage.php serves /cottages/<slug> (see htaccess.txt) with that
// cottage's live price, calendar and photos, which is the page the email is
// actually about. Falls back to the site root when there is no slug, so a
// cottage added before the migration still gets a working link.
function email_cottage_url($propKey)
{
    $base = function_exists('site_base_url') ? site_base_url() : '';
    if ($base === '') {
        return '';
    }
    $slug = function_exists('prop_display') ? trim((string) (prop_display((string) $propKey)['slug'] ?? '')) : '';
    return $slug !== '' ? rtrim($base, '/') . '/cottages/' . rawurlencode($slug) : $base;
}

// The owner's bank details for guests paying by transfer, as typed in
// Manage → Payments. Empty until they fill it in — payment_cta() handles that
// case rather than printing a blank instruction.
function bacs_details()
{
    return trim((string) content_value('bacs-details'));
}

// THE "HOW TO PAY" HALF OF A MONEY EMAIL, chosen by the guest's rail
// (payment_rail). ONE definition, shared by the request and the reminder, so the
// first chase and every follow-up ask the same guest for money the same way — the
// chbDuties lesson: two composers over the same facts drift, and here the drift
// would be visible to the guest.
//
// $lead is the caller's sentence up to the amount ("Please pay the remaining
// £290.00") so each email keeps its own voice; this appends only the mechanism.
// Returns ['text' => …, 'html' => …]; the html half is pre-escaped.
//
// The BACS branch deliberately drops "Powered by Square" too — it is a line about
// card handling, and leaving it under bank details reads as a contradiction.
function payment_cta($rail, $payUrl, $bacs, $lead)
{
    if ($rail !== 'bacs') {
        return [
            'text' => $lead . " securely by card here:\n" . $payUrl,
            'html' =>
                email_btn($payUrl, 'Pay securely by card') .
                email_p('Powered by Square — we never see or store your card number.', true),
        ];
    }
    $bacs = trim((string) $bacs);
    if ($bacs === '') {
        // No details on file. Say something ACTIONABLE rather than printing an
        // empty bank block or — worse — falling back to a card link the guest has
        // already shown they don't use.
        return [
            'text' => $lead . " by bank transfer. Please reply to this email and we'll send you our bank details.",
            'html' => email_note(
                '<strong>Pay by bank transfer</strong><br>Please reply to this email and we&rsquo;ll send you our bank details.',
            ),
        ];
    }
    return [
        'text' => $lead . " by bank transfer, using the details below:\n\n" . $bacs,
        // Owner FREE TEXT going into guest-facing HTML — escape, then restore the
        // line breaks they typed (a sort code and an account number belong on
        // their own lines).
        'html' => email_note('<strong>Pay by bank transfer</strong><br>' . nl2br(email_esc($bacs))),
    ];
}

// ------------------------------------------------------------------
//  Square payments — request + receipt emails. Both reuse smtp_send and the
//  crown header. $b: name, email, prop_key, prop_name, check_in, check_out,
//  kind ('deposit'|'balance'), amount, total, payment_method. $payUrl: the
//  secure pay link.
//
//  The two chase emails are split into a PURE body builder + a thin sender: the
//  builder takes everything it needs (accent, bank details) as arguments so
//  test-payrail.php can drive the real composer with no DB and no SMTP. Testing
//  payment_rail() alone would have passed with either call site reverted.
// ------------------------------------------------------------------
function payment_request_body($b, $payUrl, $accent, $bacs)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $what = $b['kind'] === 'balance' ? 'remaining balance' : 'deposit';
    $rail = payment_rail($b);

    // When the refundable deposit rides this payment (first payment), state the true
    // amount the card will be charged today so the emailed figure matches checkout.
    $damages = round((float) ($b['damages'] ?? 0), 2);
    $chargedToday = round((float) $b['amount'] + $damages, 2);
    // ONE composer for the stay total + already-paid (payment_money_facts): the
    // local total here was `total + damages`, which reads £700 the moment the
    // deposit has been CHARGED (damages 0) — beside a confirmation, receipt and
    // My Stays all saying £750. The facts fold the charged deposit into BOTH the
    // stay total and the paid figure, so the balance is unmoved and the guest's
    // documents finally agree.
    $f = payment_money_facts($b, $what);
    $stayTotalGrand = $f['stayTotal'];
    $depositLineText = $f['depositTail'] !== '' ? "\n\n" . $f['depositTail'] : '';
    // The CTA quotes the SUM THE GUEST SENDS, not the rental half of it — the
    // deposit sentence beneath explains the split.
    $cta = payment_cta($rail, $payUrl, $bacs, 'To secure your stay, please pay ' . $money($f['chargedNow']));
    // …and WHEN the rest is wanted (payment_plan_line — see its note: the
    // schedule is the booking's, so this is stated on both rails).
    $planLine = payment_plan_line($f['restAfter'], $b['balance_due_date'] ?? '', $money);

    // THE DEADLINE BELONGS BESIDE THE FIGURE. On a BALANCE ask the booking's
    // balance_due_date is this payment's own deadline — and it was stated nowhere
    // in this email, because payment_plan_line answers a different question (when
    // the REMAINDER is wanted, which on a balance ask is nothing, so it returns
    // ''). So the one email whose whole job is "please settle up by then" never
    // said by when. It rides the amount block's sub, where the guest is already
    // looking, rather than a sentence further down.
    $dueBy = substr((string) ($b['balance_due_date'] ?? ''), 0, 10);
    $askDeadline = $b['kind'] === 'balance' && $dueBy !== '' ? 'Due by ' . email_date($dueBy) : '';

    // THE WHOLE PICTURE, AS A PANEL. All of this was one run-on paragraph — "The
    // full stay total is £750.00 (including the refundable deposit). Already paid:
    // £225.00 (including your £50.00 refundable deposit). The remaining £292.50 is
    // due by Fri 14 Aug 2026." — three figures a guest has to hold in their head to
    // check the fourth, set as prose. The same facts as rows are scanned, not read,
    // and they visibly add up. The text half keeps the sentences: plain text has no
    // table, and prose is the right form there.
    $sumRows = [['Stay total', '<strong>' . $esc($money($f['stayTotal'])) . '</strong>']];
    if ($f['paid'] > 0.005) {
        $sumRows[] = ['Already paid', $esc($money($f['paid']))];
    }
    $sumRows[] = [
        $f['damages'] > 0 ? 'Paying now (including the deposit)' : 'Paying now',
        '<strong>' . $esc($money($f['chargedNow'])) . '</strong>',
    ];
    if ($f['restAfter'] > 0.005) {
        $sumRows[] = [
            'Still to come' . ($dueBy !== '' ? ', by ' . $esc(email_date($dueBy)) : ''),
            $esc($money($f['restAfter'])),
        ];
    }
    $sumHtml = email_money_rows($sumRows);

    // THE MONTHLY OPTION, previewed as the SCHEDULE the checkout will offer —
    // guests deciding whether they can afford to book learn it exists here,
    // not as a surprise at the pay screen. Card rail only: a guest getting
    // bank details is not meeting this checkout. The rows are the offer's own
    // dates and figures, so the preview and the consent card cannot disagree.
    $offer = is_array($b['instalment_offer'] ?? null) && $rail === 'card' ? $b['instalment_offer'] : null;
    $offerHtml = '';
    $offerText = '';
    if ($offer) {
        $oN = (int) $offer['n'];
        $oPer = round((float) $offer['per'], 2);
        $oLast = round((float) $offer['last'], 2);
        $oRest = round($oPer * ($oN - 1) + $oLast, 2);
        $oRows = [];
        $oLines = [];
        foreach ((array) $offer['dates'] as $i => $d) {
            $fig = $i + 1 === $oN ? $money($oLast) . ' · final' : $money($oPer);
            // A SCHEDULE COLUMN STAYS NUMERIC. Every other date in these emails is
            // spoken (email_date) because it is read once and acted on; these are read
            // AGAINST EACH OTHER — four dates stacked in one column — and DD/MM/YYYY is
            // fixed-width, so the rows align and the interval between them is legible
            // at a glance. A spoken column ('Sat 29 Aug 2026' over 'Mon 28 Sep 2026')
            // is ragged and reads as prose repeated four times.
            $oRows[] = ['Payment ' . ($i + 1) . ' — ' . uk_date($d), $fig];
            $oLines[] = '  ' . ($i + 1) . '. ' . uk_date($d) . ' — ' . $fig;
        }
        $offerLead = 'Rather spread the ' . $money($oRest) . " that's left? When you pay, you can choose:";
        $offerFine = 'From the card you pay with — an email before each one, and you can turn it off any time.';
        $offerHtml = email_p('<strong>' . $esc($offerLead) . '</strong>', true) . email_rows($oRows) . email_p($esc($offerFine), true);
        $offerText = "\n\n" . $offerLead . "\n" . implode("\n", $oLines) . "\n" . $offerFine;
    }

    // THE FIGURE (AND THE DATE) IN THE SUBJECT: it is what is read on a lock screen, and
    // what a search for "£525" finds later.
    $subject = $b['kind'] === 'balance' && $dueBy !== ''
        ? $money($f['chargedNow']) . ' due ' . email_date($dueBy, false) . " — {$prop}"
        : "Pay your {$what}: " . $money($f['chargedNow']) . " for {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Thank you for booking {$prop} (" . email_date($b['check_in']) . " to " . email_date($b['check_out']) . ").\n\n" .
        $cta['text'] .
        $depositLineText .
        "\n\n" .
        ($askDeadline !== '' ? $askDeadline . ".\n\n" : '') .
        'The full stay total is ' .
        $money($stayTotalGrand) .
        ($damages > 0 ? ' (including the refundable deposit)' : '') .
        '.' .
        // What they have ALREADY put down — a balance request that never says so
        // leaves the guest to work it out from two other numbers.
        ($f['paidLine'] !== '' ? ' ' . $f['paidLine'] : '') .
        ($planLine !== '' ? ' ' . $planLine : '') .
        $offerText .
        "\n\nYou can reply to this email with any questions.\n\n" .
        'Cottage Holidays Blakeney';

    $inner =
        email_eyebrow($accent, $prop . ' · ' . email_range($b['check_in'], $b['check_out'])) . email_h('Pay your ' . $what) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', thank you for booking <strong style="color:#1B2A34;">' .
                $esc($prop) .
                '</strong> (' .
                $esc(email_date($b['check_in'])) .
                ' to ' .
                $esc(email_date($b['check_out'])) .
                ').',
        ) .
        email_amount(
            $f['payLabel'],
            $money($f['chargedNow']),
            ($f['paySub'] !== '' ? $f['paySub'] . '<br>' : '') .
                ($askDeadline !== '' ? '<strong>' . $esc($askDeadline) . '</strong><br>' : '') .
                $esc($f['contextLine']),
        ) .
        // THE ACTION COMES BEFORE THE ARITHMETIC. The pay button used to sit below
        // the deposit explanation; a guest who has already decided to pay should not
        // have to read past a paragraph about a refundable deposit to reach it. The
        // panel and the small print follow for the guest who wants to check.
        $cta['html'] .
        $sumHtml .
        ($damages > 0
            ? email_footnote(
                'The <strong>' . $money($damages) . '</strong> security deposit is refundable &mdash; it comes back to you after checkout.',
            )
            : '') .
        ($planLine !== '' ? email_footnote($esc($planLine)) : '') .
        $offerHtml .
        email_p('Any questions? Just reply to this email.<br>Cottage Holidays Blakeney', true);
    // The inbox preview finishes the thought: the figure and what it does, not
    // the subject said twice. A deposit ask has no due-by (its money is due now).
    $html = email_shell(
        $money($f['chargedNow']) . ($what === 'deposit' ? ' secures your dates' : ' settles your stay') .
            ($askDeadline !== ''
                ? ' — ' . lcfirst($askDeadline)
                // The card phrasing only on the card rail — a BACS body carries
                // bank details and no card link, so the preview must not promise one.
                : ($rail === 'card' ? ' — pay securely by card in two taps' : ' — how to pay is inside')),
        $inner,
        $accent,
    );

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}
// Thin sender: resolve what the builder can't (the cottage accent and the owner's
// bank details both need the DB) and hand off to smtp_send.
function send_payment_request($b, $payUrl)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $m = payment_request_body($b, $payUrl, $accent, bacs_details());
    return smtp_send($b['email'], first_name($b['name'], 'Guest'), $m['subject'], $m['text'], $m['html']);
}

// High-level: build the secure pay link for a booking row + kind and email the
// guest the request. Returns ['ok'=>bool,'error'=>string,'amount'=>float].
// Requires db.php + pricing.php to be loaded (always true for callers). The
// amount is derived server-side from the booking; nothing is trusted from input.
function request_booking_payment($b, $kind, $reminder = false)
{
    $kind = $kind === 'balance' ? 'balance' : 'deposit';
    if (!square_enabled()) {
        return ['ok' => false, 'error' => 'Square payments are not switched on.'];
    }
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file.'];
    }
    $amt = booking_amount_due($b, $kind);
    if ($amt['due'] <= 0) {
        return ['ok' => false, 'error' => 'Nothing left to pay.', 'amount' => 0];
    }
    // No stage in the link — pay.php derives it from the booking on open, so an
    // email sent weeks ago asks for whatever the plan wants NOW. The composed
    // email still quotes $kind's figures, which are right at the moment of
    // sending; the link simply stops promising they still will be.
    $payUrl = site_base_url() . 'index.html?pay=' . pay_token($b['id']) . '&b=' . (int) $b['id'];
    $rate = get_rate($b['prop_key']);
    // The refundable damage deposit is CHARGED with the guest's first rental payment
    // (only while hold_status is 'none') and returned after checkout. Mirror pay.php's
    // derivation so the email states the full amount the card will be charged, not
    // just the rental portion. Zero once the deposit has already ridden a payment.
    $damages = 0.0;
    if (($b['hold_status'] ?? 'none') === 'none') {
        $damages = round((float) ($b['agreed_booking_fee'] ?? 0), 2);
        // Legacy rows (no snapshot) fall back to a live calc; a modern row with a
        // waived (£0) deposit stays £0 rather than showing the property standard.
        if (($b['agreed_total'] ?? null) === null && $rate) {
            $pp = price_breakdown($rate, $b['adults'], $b['children'], $b['check_in'], $b['check_out']);
            $damages = round((float) ($pp['damagesDeposit'] ?? 0), 2);
        }
    }
    // The deposit ALREADY taken (charged with the first payment, or a captured/kept
    // legacy hold) — the other half of the deposit story from $damages above, which
    // is only the deposit still TO ride this payment. Without it a balance chase
    // quoted the rental rail ("£175.00 already paid" of "£700.00 total") at a guest
    // whose card took £225 and whose confirmation, receipt, invoice and My Stays all
    // say £225 of £750 — the one document telling a different story, reported with a
    // screenshot. Mirrors send_booking_confirmation's $chargedDep derivation.
    $depCharged = in_array(($b['hold_status'] ?? 'none'), ['charged', 'captured', 'kept'], true)
        ? round((float) ($b['hold_amount'] ?? ($b['agreed_booking_fee'] ?? 0)), 2)
        : 0.0;
    $payload = [
        'name' => $b['name'],
        'email' => $b['email'],
        'prop_key' => $b['prop_key'],
        'prop_name' => $rate['name'] ?? $b['prop_key'],
        'check_in' => $b['check_in'],
        'check_out' => $b['check_out'],
        'kind' => $kind,
        'amount' => $amt['due'],
        'total' => $amt['total'],
        'damages' => $damages,
        'deposit_charged' => $depCharged,
        // booking_amount_due already works this out and it was being discarded, so
        // neither email could tell a part-paid guest what they had put down.
        'paid' => $amt['alreadyPaid'],
        // Carried so the email can pick the guest's rail (payment_rail): someone
        // who paid their deposit in cash gets bank details, not a card link.
        'payment_method' => $b['payment_method'] ?? '',
        // WHEN the rest is wanted — the booking's own derived date, the same one
        // the confirmation and the hub quote, so the deposit ask states the plan
        // the owner agreed rather than leaving it in the back office. Read by
        // payment_plan_line; rail-agnostic (see its note).
        'balance_due_date' => function_exists('booking_balance_due_date') ? booking_balance_due_date($b) : ($b['balance_due_date'] ?? ''),
        // THE MONTHLY OPTION IS MENTIONED BEFORE CHECKOUT — derived from the
        // same booking_instalment_offer the pay screen shows, so the email can
        // never promise a plan the checkout won't offer, and the owner's floor
        // rides along for free: no offer, no sentence. Deposit asks only (the
        // offer exists only at the deposit stage). The REMINDER deliberately
        // stays without it: a reminder chases money already asked for, and the
        // ask is the one place the option is put forward.
        'instalment_offer' => $kind === 'deposit' && function_exists('booking_instalment_offer') ? booking_instalment_offer($b) : null,
    ];
    $res = $reminder ? send_payment_reminder($payload, $payUrl) : send_payment_request($payload, $payUrl);
    $res['amount'] = $amt['due'];
    return $res;
}

// THE MONEY FACTS OF A PAYMENT ASK, stated once. The request and its own reminder
// chase the SAME money and were composed independently, so they disagreed: the
// request said "£340.00 will be charged to your card today" (rental + the
// refundable deposit, which pay.php really does bundle) while the reminder — the
// one sent repeatedly until the guest pays — said only "£290.00". Both are handed
// the same payload; the reminder simply ignored `damages`.
//
// Returns everything either email needs to be honest about the sum: what is being
// charged now, what the deposit adds, what has already been paid, and the full
// stay total. `paid` is optional (0 when the caller has no figure) so the line is
// only claimed when it is known.
function payment_money_facts($b, $whatLabel = 'balance')
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $rail = payment_rail($b);
    $due = round((float) ($b['amount'] ?? 0), 2);
    $damages = round((float) ($b['damages'] ?? 0), 2);
    // The deposit ALREADY taken — the £50 that rode the first card payment. The
    // guest's "already paid" must include it, because it is money that left their
    // card and every other document (receipt, confirmation, invoice, My Stays)
    // already counts it: the chase said "£175.00 already paid" of "£700.00 total"
    // to a guest whose card took £225 of a £750 stay. `paid` from the payload is
    // the RENTAL rail (booking_paid_so_far) and stays available raw as paidRental.
    $depCharged = round((float) ($b['deposit_charged'] ?? 0), 2);
    $paidRental = round((float) ($b['paid'] ?? 0), 2);
    $paid = round($paidRental + $depCharged, 2);
    $rentalTotal = round((float) ($b['total'] ?? 0), 2);
    return [
        'due' => $due,
        'damages' => $damages,
        'paid' => $paid,
        'paidRental' => $paidRental,
        'chargedNow' => round($due + $damages, 2),
        // The full stay figure in BOTH deposit eras: still to ride ($damages) or
        // already taken ($depCharged) — never both, and the balance is unmoved
        // either way because the deposit adds equally to total and paid.
        'stayTotal' => round($rentalTotal + $damages + $depCharged, 2),
        'money' => $money,
        // THE HEADLINE FIGURE IS WHAT THE GUEST ACTUALLY PAYS. Both emails used
        // to lead with the rental balance while the card takes balance + the
        // refundable deposit — so the one number that mattered was the one the
        // email never showed at its own size, only in a sentence below the fold
        // (owner's screenshot: a £290.00 hero over a £340.00 charge). The
        // headline is the real sum now and the split rides directly under it,
        // so the figure is never a mystery and never a surprise at checkout.
        // (The transaction fee needs no line of its own: it is inside the
        // rental total, so it is already inside every figure here.)
        'payLabel' => $damages > 0 ? 'To pay now' : ucfirst($whatLabel) . ' due',
        'paySub' => $damages > 0
            ? $money($due) . ' ' . $whatLabel . ' + ' . $money($damages) . ' refundable deposit'
            : '',
        // The quiet context under the figure: what the stay costs in total and
        // what has already been settled.
        'contextLine' => 'Of ' . $money(round($rentalTotal + $damages + $depCharged, 2)) . ' total'
            . ($paid > 0.005 ? ', ' . $money($paid) . ' already paid' : '') . '.',
        // The deposit sentence, in the same words both emails use — and on the
        // RAIL the guest is actually on: "charged to your card today" is a card
        // sentence, and the reminder was saying it to bank-transfer guests
        // (the request had its own rail-aware copy; this one did not).
        'depositTail' => $damages > 0
            ? 'This payment also includes a refundable security deposit of ' . $money($damages)
                . ' (returned after checkout), '
                . ($rail === 'bacs'
                    ? 'so please send ' . $money(round($due + $damages, 2)) . ' in total.'
                    : 'so ' . $money(round($due + $damages, 2)) . ' will be charged to your card today.')
            : '',
        // Stated only when there IS something already paid — "£0.00 already paid"
        // on a fresh request is noise, not information. When the refundable deposit
        // is inside the figure, say so, or £225 against a remembered £175 deposit
        // ask reads as a £50 mystery in the other direction.
        'paidLine' => $paid > 0.005
            ? 'Already paid: ' . $money($paid)
                . ($depCharged > 0.005 ? ' (including your ' . $money($depCharged) . ' refundable deposit)' : '')
                . '.'
            : '',
        // What is STILL to come after this payment — the rental remainder, which
        // is what the booking's plan puts a date on. Zero on a balance ask (that
        // payment settles the stay), positive on a deposit ask.
        'restAfter' => round($rentalTotal - $paidRental - $due, 2),
    ];
}

// THE PLAN, SAID IN THE EMAIL THAT ASKS FOR THE DEPOSIT. The ask told the guest
// what to pay now and what the stay costs, and never when the rest was wanted —
// so a plan the owner had agreed lived only in the back office, exactly the gap
// the confirmation's own due-by line closed (mailer 1523). It matters most on
// the BANK rail: a card guest is at least offered the monthly schedule at
// checkout, while the offer is deliberately suppressed for a guest paying by
// transfer, so without this they were the one party to the arrangement never
// told its date. Rail-agnostic by design — the schedule is the booking's, not
// the payment method's; only the HOW-TO-PAY half follows the rail.
// The date is the booking's own (custom date, else check-in minus the window),
// so this can never quote a different day from the chaser that follows it.
function payment_plan_line($restAfter, $dueDate, $money)
{
    $rest = round((float) $restAfter, 2);
    $due = substr((string) $dueDate, 0, 10);
    if ($rest <= 0.005 || $due === '') {
        return '';
    }
    return 'The remaining ' . $money($rest) . ' is due by ' . email_date($due) . '.';
}

// A gentler nudge for a balance that's been requested but not yet paid, sent in
// the run-up to arrival. Same rail as the request; warmer copy + days-until-arrival.
function payment_reminder_body($b, $payUrl, $accent, $bacs)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    // ANCHORED AT UTC MIDNIGHT, like pricing.php and bookings.php already are.
    // Both timestamps were LOCAL under Europe/London, so an interval spanning the
    // spring-forward Sunday is N*86400 − 3600 seconds and floor() returns N−1: the
    // reminder told a guest "your arrival is in 6 days" for a stay 7 days away.
    // (Autumn is harmless — the extra hour rounds down inside the same day.) The
    // reminder pass runs for arrivals 3–14 days out, so late March is squarely in
    // its window. Verified: 2027-03-26 → 2027-04-02 now yields 7, was 6.
    $days = max(0, (int) floor((strtotime($b['check_in'] . ' UTC') - strtotime(date('Y-m-d') . ' UTC')) / 86400));
    $when = $days <= 1 ? 'tomorrow' : "in {$days} days";
    $rail = payment_rail($b);
    // A reminder chases whichever stage was asked for — usually the balance, but
    // the abandoned-deposit recovery pass reminds a DEPOSIT. Reading the kind here
    // (not hard-wiring 'balance') keeps the subject, wording, facts and deadline
    // coherent: a deposit reminder must say "deposit", quote the deposit facts,
    // and carry NO "Due by <balance date>" — its own money is due now.
    $kind = ($b['kind'] ?? 'balance') === 'deposit' ? 'deposit' : 'balance';
    $noun = $kind === 'deposit' ? 'deposit' : 'balance';
    // The SAME facts the request stated, so the chase cannot quote a smaller sum
    // than the one the card will take — including in the CTA, which used to name
    // the rental half while the deposit sentence beneath added the rest.
    $f = payment_money_facts($b, $kind);
    $cta = payment_cta($rail, $payUrl, $bacs, 'Please pay ' . $money($f['chargedNow']));
    // The SAME deadline treatment the request now gets — this is the email that
    // chases it, so it is the last email that should leave the date unstated. A
    // DEPOSIT reminder carries no deadline: its own money is due now, and the
    // balance date would misstate when this payment is wanted.
    $dueBy = $kind === 'balance' ? substr((string) ($b['balance_due_date'] ?? ''), 0, 10) : '';
    $askDeadline = $dueBy !== '' ? 'Due by ' . email_date($dueBy) : '';
    // And the SAME panel, for the same reason: three figures that have to reconcile
    // are read as rows, not as a sentence. One composer's worth of rows would be
    // ideal, but the two emails legitimately show different sets (a reminder has no
    // "still to come" — the balance IS the remainder), so they share the FACTS
    // (payment_money_facts) rather than the layout, which is where the drift risk
    // actually lives.
    $sumRows = [['Stay total', '<strong>' . $esc($money($f['stayTotal'])) . '</strong>']];
    if ($f['paid'] > 0.005) {
        $sumRows[] = ['Already paid', $esc($money($f['paid']))];
    }
    $sumRows[] = [
        $f['damages'] > 0 ? 'Still to pay (including the deposit)' : 'Still to pay',
        '<strong>' . $esc($money($f['chargedNow'])) . '</strong>',
    ];

    $subject = 'Reminder: ' . $money($f['chargedNow']) .
        ($dueBy !== '' ? ' due ' . email_date($dueBy, false) : ($kind === 'deposit' ? ' deposit due now' : ' due')) . " — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Just a friendly reminder that the {$noun} for your stay at {$prop} is still outstanding, " .
        "and your arrival is {$when} (" . email_date($b['check_in']) . ").\n\n" .
        ($askDeadline !== '' ? $askDeadline . ".\n\n" : '') .
        $cta['text'] .
        ($f['depositTail'] !== '' ? "\n\n" . $f['depositTail'] : '') .
        ($f['paidLine'] !== '' ? "\n\n" . $f['paidLine'] : '') .
        "\n\n" .
        "If you've already paid, thank you — please ignore this. Any questions, just reply.\n\n" .
        'Cottage Holidays Blakeney';

    $inner =
        email_eyebrow($accent, $prop . ' · ' . email_range($b['check_in'], $b['check_out'])) . email_h('A reminder about your ' . $noun) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', a friendly reminder that the ' . $esc($noun) . ' for your stay at <strong style="color:#1B2A34;">' .
                $esc($prop) .
                '</strong> is still outstanding, and your arrival is <strong style="color:#1B2A34;">' .
                $esc($when) .
                '</strong> (' .
                $esc(email_date($b['check_in'])) .
                ').',
        ) .
        email_amount(
            $f['payLabel'],
            $money($f['chargedNow']),
            ($f['paySub'] !== '' ? $f['paySub'] . '<br>' : '') .
                ($askDeadline !== '' ? '<strong>' . $esc($askDeadline) . '</strong><br>' : '') .
                $esc($f['contextLine']),
        ) .
        $cta['html'] .
        email_money_rows($sumRows) .
        ($f['depositTail'] !== '' ? email_footnote($esc($f['depositTail'])) : '') .
        email_footnote('Already paid? Thank you &mdash; please ignore this.') .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell(
        $money($f['chargedNow']) . ' settles your stay' .
            ($askDeadline !== '' ? ' — ' . lcfirst($askDeadline) : '') .
            // Only promise "by card" on the card rail — a BACS guest's body
            // deliberately carries bank details and no card link, so the inbox
            // preview must not contradict it.
            ($rail === 'card' ? ' · two taps by card' : ''),
        $inner,
        $accent,
    );

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}
// Thin sender (see payment_request_body's note on the split).
function send_payment_reminder($b, $payUrl)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $m = payment_reminder_body($b, $payUrl, $accent, bacs_details());
    return smtp_send($b['email'], first_name($b['name'], 'Guest'), $m['subject'], $m['text'], $m['html']);
}

// Ask the guest to place a refundable card HOLD before arrival. $b: name, email,
// prop_key, prop_name, check_in, check_out, amount. $url: the secure hold link.
function send_hold_request($b, $url)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent'];
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';

    // THE SUBJECT HAS TO SAY IT ISN'T A CHARGE. "Refundable card hold" was read
    // in the inbox by a guest who has already paid a deposit, and the word it
    // lands on is "card" — so the reassurance that the whole email exists to give
    // arrived only after they opened it worried. It leads now, in both the subject
    // and the preheader.
    $subject = "Nothing to pay — a refundable card hold for {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Ahead of your stay at {$prop} (" . email_date($b['check_in']) . " to " . email_date($b['check_out']) . "), please place the refundable " .
        'security hold of ' .
        $money($b['amount']) .
        " on your card here:\n" .
        $url .
        "\n\n" .
        'This is a HOLD, not a charge — the amount is simply set aside on your card and released after checkout, ' .
        "provided there's no damage. Powered by Square; we never see your card number.\n\n" .
        'Cottage Holidays Blakeney';

    $inner =
        email_eyebrow($accent, $prop . ' · ' . email_range($b['check_in'], $b['check_out'])) . email_h('Place your security hold') .
        email_p(
            'Hello ' .
                $esc($name) .
                ', ahead of your stay (' .
                $esc(email_date($b['check_in'])) .
                ' to ' .
                $esc(email_date($b['check_out'])) .
                ') please place the refundable security hold on your card.',
        ) .
        email_amount('Refundable hold', $money($b['amount']), 'held, not charged') .
        // WHAT IT IS, BEFORE THE BUTTON THAT DOES IT. This paragraph sat BELOW the
        // button, so a guest being asked to put £250 against their card had to tap
        // first and read the reassurance second. Nothing else in these emails asks
        // for an authorisation, so this is the one place the order matters.
        email_note(
            'This is a <strong>hold, not a charge</strong> &mdash; the amount is set aside on your card and released after checkout, provided there&rsquo;s no damage.',
        ) .
        email_btn($url, 'Place the card hold') .
        email_footnote('Powered by Square &mdash; we never see or store your card number.') .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell('A refundable hold on your card — nothing is charged', $inner, $accent);
    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Tell the guest their card hold has been released. $b: name, email, prop_key,
// prop_name, amount.
function send_hold_released($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent'];
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';

    $subject = "Your security hold has been released — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Thank you for staying at {$prop}. We've released the refundable security hold of " .
        $money($b['amount']) .
        ' on your card. ' .
        "It usually clears from your statement in 3-5 working days, though some banks take a little longer.\n\n" .
        "We hope to welcome you back.\nCottage Holidays Blakeney";

    $inner =
        email_h('Security hold released', $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', thank you for staying at <strong style="color:#1B2A34;">' .
                $esc($prop) .
                '</strong>. We\'ve released your refundable security hold.',
        ) .
        email_amount('Hold released', $money($b['amount']), '', email_accent_ink()) .
        // A NUMBER, NOT "A FEW". This email exists to stop the guest wondering, and
        // "a few working days" is exactly vague enough to leave them checking their
        // statement daily and then emailing to ask. 3-5 working days is the honest
        // range for a released authorisation, and the hedge that follows it is about
        // their bank rather than about us.
        email_footnote('It usually clears from your statement in 3&ndash;5 working days, though some banks take a little longer.') .
        email_p('We hope to welcome you back.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Your security hold has been released — ' . $prop, $inner, $accent);
    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Tell the guest a refund is on its way. $b: name, email, prop_key, prop_name,
// check_in, check_out, amount.
function send_refund_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $reason = trim((string) ($b['reason'] ?? ''));

    $subject = $money($b['amount']) . " refunded to your card — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "We've issued a refund of " .
        $money($b['amount']) .
        " for your booking at {$prop}" .
        (!empty($b['check_in']) ? " (" . email_date($b['check_in']) . " to " . email_date($b['check_out']) . ")" : '') .
        ".\n\n" .
        ($reason !== '' ? "A note from " . email_host_name() . ": {$reason}\n\n" : '') .
        "It's been sent back to the card you paid with, and usually appears in 3-5 working days,\n" .
        "though some banks take a little longer.\n\n" .
        "WHAT HAPPENS NEXT\n[x] Refund issued — today\n[ ] It reaches your card — 3-5 working days\n\n" .
        "Any questions, just reply to this email.\n\nCottage Holidays Blakeney";

    $inner =
        email_h('Refund on its way', $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', we\'ve issued a refund for your booking at <strong style="color:#1B2A34;">' .
                $esc($prop) .
                '</strong>' .
                (!empty($b['check_in']) ? ' (' . $esc(email_date($b['check_in'])) . ' to ' . $esc(email_date($b['check_out'])) . ')' : '') .
                '.',
        ) .
        email_amount('Refund', $money($b['amount']), '', email_accent_ink()) .
        // "REASON:" IS A FORM FIELD, NOT A SENTENCE. That box is a note the owner
        // wrote for their own records, and rendering it under a bold "Reason:" made
        // the SITE appear to be justifying itself to the guest — in the register of
        // a rejection letter, on an email about money going back. Attributed to the
        // person who wrote it, the same words read as what they are.
        email_ownernote(email_host_name(), $reason) .
        email_timeline([['Refund issued', 'Today', true], ['It reaches your card', '3–5 working days', false]]) .
        email_footnote(
            'It&rsquo;s on its way back to the card you paid with, and usually appears in 3&ndash;5 working days &mdash; though some banks take a little longer.',
        ) .
        email_p('Any questions? Just reply to this email.<br>Cottage Holidays Blakeney', true);
    $html = email_shell(
        $money($b['amount']) . ' is on its way back to your card — usually 3 to 5 working days',
        $inner,
        $accent,
    );

    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Damage-deposit return after a stay. $b: name, email, prop_key, prop_name,
// check_in, check_out, amount, held, reason (retention note), manual (bool).
function send_deposit_return_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $accent = prop_display($b['prop_key'] ?? '')['accent']; // per-cottage accent (works for owner-added cottages too)
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $reason = trim((string) ($b['reason'] ?? ''));
    $held = (float) ($b['held'] ?? $b['amount']);
    $retained = round(max(0, $held - (float) $b['amount']), 2);
    // OFF THE CARD RAIL the owner sends this by hand, the way the guest paid: say THAT,
    // and never promise a card refund's 3-5 working days for money the owner moves.
    $manual = !empty($b['manual']);
    $method = strtolower(trim((string) ($b['method'] ?? '')));
    $last4 = preg_match('/^\d{4}$/', (string) ($b['last4'] ?? '')) ? (string) $b['last4'] : '';
    $cardName = $last4 !== '' && trim((string) ($b['brand'] ?? '')) !== '' ? trim((string) $b['brand']) : 'card';
    $how = $manual
        ? ($method !== '' ? 'by ' . $method . ', the way you paid' : 'by the method we agreed')
        : ($last4 !== '' ? 'to your ' . $cardName . ' ending ' . $last4 : 'to the card you paid with');

    $subject = $retained > 0.001
        ? 'Your deposit: ' . $money($b['amount']) . " returned — {$prop}"
        : 'Your ' . $money($b['amount']) . " deposit is on its way back — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Thank you for staying at {$prop}. We're returning your refundable damage deposit.\n\n" .
        'Returned: ' .
        $money($b['amount']) .
        " ({$how}).\n" .
        ($retained > 0.001 ? 'Retained: ' . $money($retained) . ' of the ' . $money($held) . " held.\n" : '') .
        ($retained > 0.001 && $reason !== '' ? "\nA note from " . email_host_name() . ": {$reason}\n" : '') .
        ($manual
            ? "\nIt should reach you shortly. If it hasn't arrived within a few working days, just reply and let us know.\n\n" .
                "WHAT HAPPENS NEXT\n[x] Sent — today\n[ ] It reaches you — shortly\n\n"
            : "\nIt usually appears in 3-5 working days, though some banks take a little longer.\n\n" .
                "WHAT HAPPENS NEXT\n[x] Returned — today\n[ ] It reaches you — 3-5 working days\n\n") .
        "We hope to welcome you back.\n\nCottage Holidays Blakeney";

    $inner =
        email_h($retained > 0.001 ? 'Your deposit' : 'Your deposit is on its way back', $accent) .
        email_p(
            'Hello ' .
                $esc($name) .
                ', thank you for staying at <strong style="color:#1B2A34;">' .
                $esc($prop) .
                '</strong>. We\'re returning your refundable damage deposit.',
        ) .
        email_amount('Deposit returned', $money($b['amount']), $esc('Sent ' . $how), email_accent_ink()) .
        // A PART-RETURN HAS TO SHOW ITS ARITHMETIC. "Amount retained: £25.00" told
        // the guest a figure and left them to work out what it was a share of — on
        // the one email most likely to be queried. The rows state held, retained and
        // returned so the three visibly reconcile, and the owner's explanation is
        // attributed to them (the "Reason:" note above) rather than presented as the
        // site's ruling.
        ($retained > 0.001
            ? email_money_rows([
                ['Deposit held', $esc($money($held))],
                ['Retained', $esc($money($retained))],
                ['Returned to you', '<strong>' . $esc($money($b['amount'])) . '</strong>'],
            ]) . email_ownernote(email_host_name(), $reason)
            : '') .
        email_timeline([[$manual ? 'Sent' : 'Returned', 'Today', true], ['It reaches you', $manual ? 'Shortly' : '3–5 working days', false]]) .
        email_footnote($manual ? 'If it has not arrived within a few working days, reply to this email.' : 'Some banks take a little longer.') .
        email_p('We hope to welcome you back.<br>Cottage Holidays Blakeney', true);
    $html = email_shell(
        $money($b['amount']) . ($manual ? ' is on its way back to you' : ' is on its way back to you — usually 3 to 5 working days'),
        $inner,
        $accent,
    );

    return smtp_send($b['email'], $name, $subject, $text, $html);
}

// Booking cancellation notice. $b: name, email, prop_key, prop_name, check_in,
// check_out, refund (amount), card (bool — refunded to card vs manual), reason.
// Pure — split out for the reason payment_request_body / owner_payment_notice_body
// were: a gate that reads mailer.php's source proves the words EXIST, not that
// they are ever reached.
function send_cancellation_email_body($b)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $reason = trim((string) ($b['reason'] ?? ''));
    // THE HOST'S NAME ARRIVES ON THE PAYLOAD, not from a content_value() call in
    // here — this builder is PURE by design (test-payrail drives it with no
    // database, the same reason payment_request_body takes $bacs as an argument).
    // Empty falls back to email_ownernote's own "A note from us".
    $host = trim((string) ($b['host_name'] ?? ''));
    $refund = (float) ($b['refund'] ?? 0);
    $refundLine =
        $refund > 0.001
            ? 'A refund of ' .
                $money($refund) .
                (!empty($b['card']) ? ' is on its way back to the card you paid with' : ' will be arranged with you') .
                '.'
            : '';
    // THE DEPOSIT IS THEIR MONEY TOO. A guest whose refundable deposit went back
    // on its own Square refund was told nothing about it here — the email named
    // the rental refund only — so the amount landing on their statement did not
    // match the one sentence they had in writing. Stated ONLY when it actually
    // went: a deposit whose refund was refused is being returned by hand, and
    // promising a mechanism that has already failed is worse than saying nothing
    // (the owner is told to settle it, and the activity log carries it).
    $depBack = round((float) ($b['deposit_refunded'] ?? 0), 2);
    $depLine = $depBack > 0.001
        ? 'Your refundable damage deposit of ' . $money($depBack) . ' is also on its way back to the card you paid with.'
        : '';

    // OUTCOME IN NUMBERS when money is coming back; the plain fact otherwise.
    $backTotal = round(($refund > 0.001 ? $refund : 0) + $depBack, 2);
    $subject = $backTotal > 0.001
        ? 'Cancelled — ' . $money($backTotal) . ' is on its way to you'
        : "Booking cancelled — {$prop}";
    $text =
        "Hello {$name},\n\n" .
        "Your booking at {$prop}" .
        (!empty($b['check_in']) ? " (" . email_date($b['check_in']) . " to " . email_date($b['check_out']) . ")" : '') .
        " has been cancelled.\n\n" .
        ($reason !== '' ? 'A note from ' . ($host !== '' ? $host : 'us') . ": {$reason}\n\n" : '') .
        ($refundLine !== '' ? $refundLine . "\n\n" : '') .
        ($depLine !== '' ? $depLine . "\n\n" : '') .
        ($refundLine !== '' || $depLine !== ''
            ? "Card refunds usually appear in 3-5 working days, though some banks take a little longer.\n\n"
            : '') .
        ($backTotal > 0.001
            ? "WHAT HAPPENS NEXT\n[x] Refund issued — today\n[ ] It reaches your card — 3-5 working days\n\n"
            : '') .
        (($b['rebook_url'] ?? '') !== '' ? "Look at other dates: " . $b['rebook_url'] . "\n\n" : '') .
        "If you have any questions, just reply to this email.\n\nCottage Holidays Blakeney";

    $inner =
        email_h('Booking cancelled') .
        email_p(
            'Hello ' .
                $esc($name) .
                ', your booking at <strong style="color:#1B2A34;">' .
                $esc($prop) .
                '</strong>' .
                (!empty($b['check_in']) ? ' (' . $esc(email_date($b['check_in'])) . ' to ' . $esc(email_date($b['check_out'])) . ')' : '') .
                ' has been cancelled.',
        ) .
        // The owner's note, attributed — see send_refund_email. On a CANCELLATION the
        // register matters more than anywhere else: "Reason: guest changed their
        // mind" set as the email's own bold heading reads like a file being closed
        // on someone.
        email_ownernote($host, $reason) .
        // THE FIGURE FIRST when money is coming back, then the arithmetic and what
        // happens next — the same anatomy every other money email now has. Where the
        // rental refund is by hand ("will be arranged with you"), the sentences stay.
        ($backTotal > 0.001 && !empty($b['card']) ? email_amount('Back to your card', $money($backTotal), 'Usually 3&ndash;5 working days', email_accent_ink()) : '') .
        ($backTotal > 0.001 && !empty($b['card']) && $refund > 0.001 && $depBack > 0.001
            ? email_money_rows([['Rental refund', $esc($money($refund))], ['Refundable deposit', $esc($money($depBack))], ['Total back to you', '<strong>' . $esc($money($backTotal)) . '</strong>']])
            : '') .
        (($backTotal > 0.001 && empty($b['card'])) || ($refundLine !== '' && !$backTotal) ? email_note($esc($refundLine)) : '') .
        ($backTotal > 0.001 && empty($b['card']) && $depLine !== '' ? email_note($esc($depLine)) : '') .
        // The deposit is stated in words too, not only as a row — the amount that lands
        // on their statement should match a sentence they hold in writing.
        ($backTotal > 0.001 && !empty($b['card']) && $depLine !== '' ? email_footnote($esc($depLine)) : '') .
        // Money going back is the one thing this email leaves the guest waiting on,
        // so it says what happens and how long — only when something is coming back.
        ($backTotal > 0.001
            ? email_timeline([['Refund issued', 'Today', true], ['It reaches your card', '3–5 working days', false]]) .
                email_footnote('Some banks take a little longer.')
            : '') .
        (($b['rebook_url'] ?? '') !== '' ? email_btn2((string) $b['rebook_url'], 'Look at other dates') : '') .
        email_p('If you have any questions, just reply to this email.<br>Cottage Holidays Blakeney', true);
    $html = email_shell('Booking cancelled — ' . $prop, $inner);

    return ['subject' => $subject, 'text' => $text, 'html' => $html, 'name' => $name];
}
function send_cancellation_email($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    // Resolve the DB-backed bits HERE, so the builder above stays pure.
    $m = send_cancellation_email_body($b + ['host_name' => email_host_name(), 'rebook_url' => email_cottage_url($b['prop_key'] ?? '')]);
    return smtp_send($b['email'], $m['name'], $m['subject'], $m['text'], $m['html']);
}

// ---- "WE'LL TAKE IT ON FRIDAY" ---------------------------------------------
// The notice that goes out AUTOPAY_NOTICE_DAYS before an automatic collection.
// Not a request — there is nothing for the guest to do — so it must not read
// like one: no pay button, no balance chase, no urgency. Its whole job is that
// the charge is recognised when it lands, and that anyone who has changed their
// mind has an unhurried way to say so before the money moves.
//
// Takes the booking row and the pay token separately for the same reason the
// two body builders do: it is pure, so the gate can drive the real composer.
function send_autopay_notice($b, $payUrl = null)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $m = autopay_notice_body($b, $payUrl);
    return smtp_send($b['email'], first_name($b['name'], 'Guest'), $m['subject'], $m['text'], $m['html']);
}

// The PURE composer, split out for the reason payment_request_body is: a gate
// that can only read the source proves the words exist, not that they are ever
// reached — measured, a check written that way passed with the branch that
// selects them forced dead.
function autopay_notice_body($b, $payUrl = null)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = !empty($b['prop_name']) ? $b['prop_name'] : (function_exists('prop_display') ? prop_display((string) ($b['prop_key'] ?? ''))['name'] : 'your cottage');
    $amt = round((float) ($b['autopay_amount'] ?? 0), 2);
    if ($payUrl === null) {
        $payUrl = site_base_url() . 'index.html?pay=' . pay_token((int) $b['id']) . '&b=' . (int) $b['id'];
    }
    // A MONTHLY plan's notice names WHICH payment this is and what follows —
    // an automatic charge the guest can place in their own schedule is one
    // they expected; an unplaced one is a dispute. The date is the NEXT
    // collection, and the position comes from the same schedule the guest was
    // shown at consent (guarded: mailer loads without pricing on some paths).
    $apN = (int) ($b['autopay_instalments'] ?? 0);
    $monthly = $apN > 1 && function_exists('booking_instalment_schedule');
    $noticeDate = substr((string) ($b['autopay_next_at'] ?? ''), 0, 10) ?: substr((string) ($b['autopay_due'] ?? ''), 0, 10);
    $when = email_date($noticeDate !== '' ? $noticeDate : (string) ($b['autopay_due'] ?? ''));
    $ofN = '';
    $tail = '';
    if ($monthly) {
        $sched = booking_instalment_schedule(substr((string) $b['autopay_due'], 0, 10), $apN);
        $pos = 1;
        foreach ($sched as $i => $d) {
            if ($d === $noticeDate) {
                $pos = $i + 1;
            }
        }
        $ofN = "payment {$pos} of {$apN}";
        $tail =
            $pos < $apN
                ? ($apN - $pos) . ' more monthly payment' . ($apN - $pos === 1 ? ' follows' : 's follow') . ', the last on ' . email_date(end($sched)) . " — and then your stay is all paid."
                : 'This is the final payment — after it your stay is all paid.';
    }
    $subject = $monthly ? "Coming up: {$ofN} — {$money($amt)} on {$when}" : "Coming up: we'll collect {$money($amt)} on {$when}";
    $body = $monthly
        ? "we're getting your stay at {$prop} ready. As you arranged when you paid your deposit, we'll collect your next monthly payment of " .
            $money($amt) .
            " — {$ofN} — from the card you saved on {$when}."
        : "we're getting your stay at {$prop} ready. As you arranged when you paid your deposit, we'll collect the remaining " .
            $money($amt) .
            " from the card you saved on {$when}.";
    $off = "There's nothing to do — this is just so it isn't a surprise. If you'd rather pay another way, or you'd like to stop the automatic payment, you can turn it off from your booking page any time before then.";
    $text =
        "Hello {$name},\n\n" .
        ucfirst($body) .
        ($tail !== '' ? "\n\n" . $tail : '') .
        "\n\n" .
        $off .
        "\n\n" .
        "Your booking: {$payUrl}\n\n" .
        'Cottage Holidays Blakeney';
    $rows = [['Amount', $money($amt)], ['Date', $esc($when)]];
    if ($monthly) {
        $rows[] = ['Payment', $esc($ofN)];
    }
    $rows[] = ['Cottage', $esc($prop)];
    $inner =
        email_h('A quick heads-up') .
        email_p('Hello ' . $esc($name) . ', ' . $esc($body)) .
        email_rows($rows) .
        ($tail !== '' ? email_p($esc($tail), true) : '') .
        email_p($esc($off), true) .
        email_btn($payUrl, 'View your booking') .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell('Nothing to do — it collects automatically from your saved card', $inner);

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}

// A FAILED COLLECTION TELLS THE GUEST FIRST. A declined card is usually theirs
// to fix (expired, reissued), and until this email the first failure was silent
// to the very person who could mend it — only the third became an owner duty.
// autopay-lib sends it on the first soft failure and on the failure that STOPS
// the plan; the middle attempt is silence, they already know.
function send_autopay_failure($b, $why, $stopped, $today = null, $charge = null, $restNow = null)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $m = autopay_failure_body($b, $why, $stopped, $today, $charge, null, $restNow);
    return smtp_send($b['email'], first_name($b['name'], 'Guest'), $m['subject'], $m['text'], $m['html']);
}

// Pure, same reason as autopay_notice_body — and the one email in the plan's
// life carrying BAD news, so its jobs come in order: the booking is safe, here
// is exactly where the plan stands (the notice email's own rows, the declined
// one saying so in place), here is the one-minute fix. $why is
// autopay_square_why's prose, never a raw body. $stopped separates "we'll try
// again on <date>" from "we've stopped trying" — the two must never blur,
// because the first promises a charge and the second promises its absence.
function autopay_failure_body($b, $why, $stopped, $today = null, $charge = null, $payUrl = null, $restNow = null)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $today = $today !== null ? substr((string) $today, 0, 10) : date('Y-m-d');
    $name = first_name($b['name'], 'Guest');
    $prop = !empty($b['prop_name']) ? $b['prop_name'] : (function_exists('prop_display') ? prop_display((string) ($b['prop_key'] ?? ''))['name'] : 'your cottage');
    $amt = $charge !== null ? round((float) $charge, 2) : round((float) ($b['autopay_amount'] ?? 0), 2);
    if ($payUrl === null) {
        $payUrl = site_base_url() . 'index.html?pay=' . pay_token((int) $b['id']) . '&b=' . (int) $b['id'];
    }
    // The retry day is derived, not promised loosely: last try + the collector's
    // own cadence. Guarded like the schedule below — mailer loads without
    // autopay-lib on some paths, and a day-shift on a date-only string is the
    // booking_balance_due_date shape.
    $retryDays = defined('AUTOPAY_RETRY_DAYS') ? AUTOPAY_RETRY_DAYS : 1;
    $retryIso = date('Y-m-d', strtotime($today . ' +' . $retryDays . ' days'));
    // Two forms of one date, for the two places it is read. The SENTENCE gets the
    // spoken form ("we'll try again on Sat 29 Aug 2026" — a day the guest can plan
    // around); the schedule ROW gets the numeric one, so it stays flush with the
    // other payment dates stacked above and below it in that column.
    $retry = email_date($retryIso);
    $retryNum = uk_date($retryIso);
    $apN = (int) ($b['autopay_instalments'] ?? 0);
    $monthly = $apN > 1 && function_exists('booking_instalment_schedule');
    $failDate = substr((string) ($b['autopay_next_at'] ?? ''), 0, 10) ?: substr((string) ($b['autopay_due'] ?? ''), 0, 10);
    $ofN = '';
    $rows = [];
    if ($monthly) {
        $sched = booking_instalment_schedule(substr((string) $b['autopay_due'], 0, 10), $apN);
        $per = round((float) ($b['autopay_amount'] ?? 0), 2);
        // Rows AFTER the declined one show what the collector will TAKE, not the
        // ceiling — the my-bookings card fix, mirrored: after a manual
        // part-payment the later charges shrink, so a future row printing the
        // full £per would promise more than will be collected. $restNow is what
        // is owed right now (the collector passes it — it holds the booking
        // under lock with the DB); the remainder BEYOND this attempt is that
        // minus the declined charge. The composer stays DB-FREE: with $restNow
        // null (a caller that can't cheaply derive it) the rows fall back to
        // $per, exactly as before.
        $runAfter = $restNow !== null ? round(max(0, (float) $restNow - (float) $amt), 2) : null;
        foreach ($sched as $i => $d) {
            if ($d === $failDate) {
                $ofN = 'payment ' . ($i + 1) . ' of ' . $apN;
            }
            $future = $money($per);
            if ($d > $failDate && $runAfter !== null) {
                $take = round(min($per, max(0, $runAfter)), 2);
                $runAfter = round($runAfter - $take, 2);
                $future = $money($take);
            }
            $rows[] = [
                // Numeric for the same reason as the offer schedule above.
                'Payment ' . ($i + 1) . ' — ' . uk_date($d),
                $d < $failDate
                    ? 'paid ✓'
                    : ($d === $failDate
                        ? $money($amt) . ' — declined' . ($stopped ? '' : ', retrying ' . $retryNum)
                        : $future . ($i + 1 === $apN ? ' · final' : '')),
            ];
        }
    } else {
        $rows = [['Amount', $money($amt)], ['Tried on', email_date($today)], ['Cottage', $esc($prop)]];
    }
    $subject =
        ($monthly && $ofN !== '' ? ucfirst($ofN) . " didn't go through" : "Your automatic payment didn't go through") .
        ' — ' .
        ($stopped ? "let's sort the card" : 'we\'ll try again on ' . $retry);
    // NOTHING WAS TAKEN, SAID BEFORE ANYTHING ELSE. "Your automatic payment didn't
    // go through" raises one fear first — that the card was hit anyway, or hit
    // twice — and the email answered every other question before that one. It is a
    // fact, not reassurance: a declined charge takes nothing.
    $happened =
        'we tried to take ' . $money($amt) . ' for your stay at ' . $prop . " today and it didn't go through — " . rtrim((string) $why, '.')
        . '. Nothing has been taken from your card, and your booking is completely safe.';
    $next = $stopped
        ? "We've stopped trying that card. Update it below and " .
            ($monthly ? 'the plan carries on where it left off' : 'the payment is collected as arranged') .
            ' — or pay any time, your own way. No fees either way.'
        : "We'll simply try again on {$retry}. If the card has changed, you can put it right in a minute — or pay this one now. No fees either way.";
    $tail = $stopped ? '' : 'If it keeps not going through, the plan simply pauses and the ordinary balance reminders take over — nothing is lost.';
    $text =
        "Hello {$name},\n\n" .
        ucfirst($happened) .
        "\n\n" .
        $next .
        ($tail !== '' ? "\n\n" . $tail : '') .
        "\n\n" .
        "Update your card, or pay this one now: {$payUrl}\n\n" .
        'Cottage Holidays Blakeney';
    $inner =
        email_h('Your booking is safe') .
        email_p('Hello ' . $esc($name) . ', ' . $esc($happened)) .
        email_rows($rows) .
        email_p($esc($next), true) .
        email_btn($payUrl, 'Update your card') .
        email_footnote('Or pay this one now, your own way &mdash; the same page does both.') .
        ($tail !== '' ? email_footnote($esc($tail)) : '') .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell('No charge was made — update your card any time before the retry', $inner);

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}

function send_payment_receipt($b)
{
    if (empty($b['email'])) {
        return ['ok' => false, 'error' => 'No guest email on file'];
    }
    $m = payment_receipt_body($b);
    return smtp_send($b['email'], first_name($b['name'], 'Guest'), $m['subject'], $m['text'], $m['html']);
}

// Pure, same reason as autopay_notice_body above.
function payment_receipt_body($b)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $name = first_name($b['name'], 'Guest');
    $prop = $b['prop_name'] ?: 'your cottage';
    $what = $b['kind'] === 'balance' ? 'balance' : 'deposit';
    // A SLICE IS NOT ITS STAGE. "we've received your balance payment of £120.00"
    // says the balance is settled — directly above this same email's own
    // "Remaining balance: £220.00". Named for what it is, the two agree.
    $partial = !empty($b['partial']);
    // The refundable damage deposit is charged WITH this payment and refunded after
    // checkout — so the amount actually taken is rental + deposit.
    $dep = round((float) ($b['deposit_charged'] ?? 0), 2);
    $paidNow = round((float) $b['amount'] + $dep, 2);
    $depLine =
        $dep > 0
            ? 'This includes a refundable damage deposit of ' .
                $money($dep) .
                ", which we'll refund after your stay."
            : '';

    // The AUTOMATIC path is named in the subject as well as the body: this lands
    // in an inbox beside nothing the guest did, so the line that identifies it
    // has to work before it is opened.
    $auto = !empty($b['automatic']);
    // An automatic INSTALMENT collects a slice, not the whole balance — so it must
    // not claim "Balance collected" over its own "Remaining balance £Y" row.
    $autoPartial = $auto && !empty($b['partial']);
    // THE FIGURE IN THE SUBJECT: a receipt is opened to check one number.
    $subject = ($auto ? ($autoPartial ? 'Payment collected: ' : 'Balance collected: ') : 'Payment received: ') . $money($paidNow) . " — {$prop}";
    // Three states, not two: a part payment can settle the whole RENTAL while
    // the refundable deposit it displaced is still to take (a slice typed at
    // the max bound). "Remaining balance: £0.00 — we'll be in touch about
    // settling it" states a figure with nothing behind it, so that case names
    // the deposit instead. The receipt stays rental-framed on purpose — the
    // deposit is the labelled exception, as it is everywhere on this document.
    // WHAT HAPPENS NEXT, WITH A DATE AND A WAY TO DO IT. "We'll be in touch about
    // settling it before your stay" leaves the guest with nothing to act on and no
    // idea when — on a receipt, which is the email they keep and re-read. Three
    // things were missing and all three were already known at the call sites:
    // the booking's own due date, whether the rest is collected AUTOMATICALLY (in
    // which case "we'll be in touch" is simply wrong — nothing is needed from
    // them), and, on the card rail, the pay link.
    $dueBy = substr((string) ($b['balance_due_date'] ?? ''), 0, 10);
    $byWhen = $dueBy !== '' ? ' by ' . email_date($dueBy) : ' before your stay';
    $restLine = $auto
        ? 'Remaining balance: ' . $money($b['balance']) . '. We&rsquo;ll collect it automatically' . $byWhen . ' — nothing to do.'
        : 'Remaining balance: ' . $money($b['balance']) . '. You can settle it any time' . $byWhen . '.';
    $statusLine = !empty($b['fully_paid'])
        ? "Your booking is now paid in full. We can't wait to welcome you."
        : ((float) $b['balance'] <= 0.005
            ? "All that's left is your refundable damage deposit — we'll be in touch about taking it before your stay."
            : $restLine);
    // The plain-text half cannot carry an entity, so it gets its own copy of that
    // sentence. Same facts, one apostrophe apart.
    $statusText = str_replace('&rsquo;', "'", $statusLine);
    $payUrl = trim((string) ($b['pay_url'] ?? ''));
    $owes = empty($b['fully_paid']) && (float) $b['balance'] > 0.005;
    // WHAT'S LEFT, as steps: the rest of the money (and how it is collected), and the
    // refundable deposit coming back. Only what is true of THIS booking.
    $leftSteps = [];
    if ($owes) {
        $leftSteps[] = ['Balance of ' . $money($b['balance']), $auto ? 'Collected automatically' . $byWhen . ' — nothing to do' : 'Due' . $byWhen, false];
    }
    if ($dep > 0) {
        $leftSteps[] = ['Your ' . $money($dep) . ' deposit', 'Returned after checkout, provided there’s no damage', false];
    }
    $leftText = '';
    if ($leftSteps) {
        $leftText = "\nWHAT'S LEFT\n";
        foreach ($leftSteps as $st) {
            $leftText .= '[ ] ' . $st[0] . ' — ' . $st[1] . "\n";
        }
    }
    $text =
        "Hello {$name},\n\n" .
        ($auto
            ? ($autoPartial
                ? "As arranged, we've now collected " . $money($paidNow) . " towards your {$what} for {$prop}. Nothing was needed from you.\n"
                : "As arranged, we've now collected your {$what} of " . $money($paidNow) . " for {$prop}. Nothing was needed from you.\n")
            : ($partial
                ? "Thank you — we've received your payment of " . $money($paidNow) . " towards your {$what} for {$prop}.\n"
                : "Thank you — we've received your {$what} payment of " . $money($paidNow) . " for {$prop}.\n")) .
        ($depLine !== '' ? $depLine . "\n" : '') .
        "Reference: {$b['ref']}\n" .
        'Rental paid so far: ' .
        $money($b['paid_so_far']) .
        ' of ' .
        $money($b['total']) .
        ".\n" .
        $statusText .
        "\n" .
        $leftText .
        ($owes && $payUrl !== '' ? "\nPay the rest here: {$payUrl}\n" : '') .
        (!empty($b['invoice_url']) ? "\nView or download your updated invoice: {$b['invoice_url']}\n" : '') .
        "\n" .
        'Cottage Holidays Blakeney';
    $inner =
        email_h($auto ? ($autoPartial ? 'Payment collected' : 'Balance collected') : 'Payment received') .
        email_p(
            'Hello ' .
                $esc($name) .
                ', ' .
                // A charge nobody typed anything for must SAY so. "Thank you —
                // we've received your payment" reads as an acknowledgement of
                // something they just did; on the automatic path they did it
                // months ago, and an unrecognised charge is what a chargeback is
                // made of.
                (!empty($b['automatic'])
                    ? ($autoPartial
                        ? 'as arranged, we\'ve now collected <strong style="color:#1B2A34;">' . $money($paidNow) . '</strong> towards your ' . $what . ' for <strong style="color:#1B2A34;">' . $esc($prop) . '</strong>. Nothing was needed from you.'
                        : 'as arranged, we\'ve now collected your ' . $what . ' of <strong style="color:#1B2A34;">' . $money($paidNow) . '</strong> for <strong style="color:#1B2A34;">' . $esc($prop) . '</strong>. Nothing was needed from you.')
                    : ($partial
                        ? 'thank you — we\'ve received your payment of <strong style="color:#1B2A34;">' . $money($paidNow) . '</strong> towards your ' . $what . ' for <strong style="color:#1B2A34;">' . $esc($prop) . '</strong>.'
                        : 'thank you — we\'ve received your ' . $what . ' payment of <strong style="color:#1B2A34;">' . $money($paidNow) . '</strong> for <strong style="color:#1B2A34;">' . $esc($prop) . '</strong>.')),
        ) .
        // A RECEIPT'S JOB IS THE FIGURE. It was stated only inside the greeting
        // sentence, at prose size, so the one thing the guest opens a receipt to
        // check — how much was taken — was the hardest thing on the page to find.
        // The label names the state (a slice is not its stage), and the sub carries
        // the running rental total, so the whole answer is one block.
        email_amount(
            $auto ? 'Collected' : ($partial ? 'Part payment received' : 'Payment received'),
            $money($paidNow),
            $esc('Rental paid so far: ' . $money($b['paid_so_far']) . ' of ' . $money($b['total'])),
        ) .
        ($depLine !== '' ? email_footnote($esc($depLine)) : '') .
        email_rows(
            array_filter([
                ['Reference', $esc($b['ref'])],
                $dep > 0 ? ['Refundable deposit', $money($dep) . ' (refunded after checkout)'] : null,
                ['Rental paid so far', $money($b['paid_so_far']) . ' of ' . $money($b['total'])],
            ]),
        ) .
        email_p($statusLine, true) .
        ($leftSteps
            ? '<div style="font-family:' . email_sans() . ';font-size:15px;font-weight:700;color:#1B2A34;margin:18px 0 2px;">What&rsquo;s left</div>' . email_timeline($leftSteps)
            : '') .
        // WHICHEVER ACTION IS ACTUALLY WANTED LEADS. With money still owing the
        // primary action is paying it; the invoice is then the quiet one. With
        // nothing owing there is only the invoice, and it takes the primary slot
        // as it always did.
        ($owes && $payUrl !== '' ? email_btn($payUrl, 'Pay the rest now') : '') .
        (!empty($b['invoice_url'])
            ? ($owes && $payUrl !== ''
                ? email_btn2($b['invoice_url'], 'View your invoice')
                : email_btn($b['invoice_url'], 'View your invoice'))
            : '') .
        email_p('Cottage Holidays Blakeney', true);
    $html = email_shell(
        $money($paidNow) . ' received, thank you' .
            ($owes ? ' — ' . $money($b['balance']) . ' remains' : ' — you\'re all paid up') .
            ' · your receipt is inside',
        $inner,
    );

    return ['subject' => $subject, 'text' => $text, 'html' => $html];
}

// Build + send the arrival email for a saved booking row, then mark it sent.
// Returns the smtp_send result. Never throws. Requires db() (always loaded).
// The arrival email's PAYLOAD, assembled from a booking row, stated once — the
// send and the review screen's preview both build from this, so the preview
// cannot show a different cottage name, address or time from the one that goes.
function arrival_email_payload($bk, $note = '')
{
    $prop = ['name' => $bk['prop_key'] ?? '', 'address' => ''];
    try {
        $p = db()->prepare('SELECT name, address FROM properties WHERE prop_key = ?');
        $p->execute([$bk['prop_key'] ?? '']);
        $prop = $p->fetch() ?: $prop;
    } catch (\Throwable $e) {
    }
    // The door/key code (arrival-<prop>) is deliberately NOT emailed; guests
    // reveal it in-app via the geofenced "My Bookings" flow (arrival-access.php),
    // so this path never even decrypts it.
    //
    // THE HOUSE RULES TRAVEL WITH IT, resolved HERE rather than in the composer:
    // arrival_email_body is one of the pure builders, and a content_value() call
    // inside one breaks every gate that drives it with no database (the rule
    // email_host_name() already follows). Only an explicitly SAVED list travels —
    // no fallback to the two generic courtesies the cottage page shows when the
    // key is absent, because "please treat the cottage as your own home" under a
    // heading reading House rules is filler in an email a guest reads once.
    return [
        'prop_key' => $bk['prop_key'] ?? '',
        'prop_name' => $prop['name'],
        'name' => $bk['name'] ?? '',
        'email' => $bk['email'] ?? '',
        'check_in' => $bk['check_in'] ?? '',
        'check_out' => $bk['check_out'] ?? '',
        'check_in_time' => $bk['check_in_time'] ?? '15:00',
        'check_out_time' => $bk['check_out_time'] ?? '10:00',
        'address' => $prop['address'],
        'note' => $note,
        'rules' => arrival_house_rules($bk['prop_key'] ?? ''),
        // The cottage's face, resolved HERE for the same reason the rules are:
        // the composer is pure, so the photo arrives as an argument. '' (no
        // gallery, no GD, too big) simply means no band.
        'photo' => email_prop_photo($bk['prop_key'] ?? ''),
    ];
}
// The cottage's own house rules, as plain text lines, for the arrival email.
// Sanitised at the boundary: a hand-edited content row cannot put markup or a
// non-string into a guest's inbox, and a runaway list cannot make the email
// unreadable (cap 12 — the rest are on the guest's own stay screen, which is
// where the full list always lives).
function arrival_house_rules($propKey)
{
    if (trim((string) $propKey) === '') {
        return [];
    }
    $raw = content_json('houserules-' . $propKey, []);
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    foreach ($raw as $r) {
        if (!is_scalar($r)) {
            continue;
        }
        $t = trim(preg_replace('/\s+/u', ' ', (string) $r));
        if ($t !== '') {
            $out[] = mb_substr($t, 0, 160);
        }
        if (count($out) >= 12) {
            break;
        }
    }
    return $out;
}
function send_arrival_for_booking($bk, $note = '')
{
    try {
        $res = send_arrival_email(arrival_email_payload($bk, $note));
        if (!empty($res['ok'])) {
            try {
                db()
                    ->prepare('UPDATE bookings SET pre_arrival_sent = NOW() WHERE id = ?')
                    ->execute([(int) $bk['id']]);
            } catch (\Throwable $e) {
            } // column may not exist yet — email still sent
        }
        return $res;
    } catch (\Throwable $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    }
}

// ============================================================
//  OWNER NOTES — the plain-text alerts, as PURE builders
// ============================================================
// These five emails composed INLINE in reviews.php / leads.php / experiences.php /
// webpush.php / diagnostics.php, which made them the only sends nothing could reach:
// email-samples.php had no way to preview them and test-emails-render.php had no way
// to render them, so a fatal in one shipped and the owner found out by not being told
// about a review. Their LOOK was never the problem — send_owner() already wraps a
// plain-text caller in owner_alert_text_html(), so they have carried the house shell
// all along; what they lacked was a function a sample could call without the route.
//
// Each returns ['subject' => …, 'text' => …] and takes everything as arguments (the
// pure-composer rule), so the gate drives the REAL builder with no DB and no SMTP.
// Plain text on purpose: owner_alert_text_html turns blank lines into paragraphs and
// bare URLs into links, which is the whole content of an alert like this.

// THE DEEP LINK AN OWNER ALERT ENDS WITH — the push notifications' own ?open= target
// (chbOpenTarget's vocabulary: booking-42, moderation, inbox:messages, settings:<id>).
// A paragraph of its own: a link in the plain-text half, and owner_alert_text_html
// renders it as the email's one button. '' when the base URL is unknown, so a builder
// stays usable anywhere and simply carries no link.
// Is this paragraph exactly owner_open_line()'s, pointing at this site's back office?
function owner_open_url_ok($para)
{
    if (!function_exists('site_base_url')) {
        return false;
    }
    return (bool) preg_match('~^Open in the back office: ' . preg_quote(site_base_url(), '~') . '\?open=[a-z0-9:-]+$~', (string) $para);
}
// GUEST WORDS IN AN OWNER ALERT stay one quoted paragraph. The alert's renderer
// turns a paragraph of "Label: value" lines into fact rows and our deep link into
// a button, so a guest's own blank lines let their text pose as the alert's parts
// ("Amount: £900.00 / Status: Refund approved" under a real site email).
function owner_quote($text)
{
    $t = trim(preg_replace('/\R\s*\R+/u', "\n", trim((string) $text)));
    return '"' . $t . '"';
}
// A guest's name in an owner alert: one plain line, and no spaced dash — the
// subject is split on those to make the title, so a name could set the heading.
function owner_name($name)
{
    $n = trim(preg_replace('/\s+/u', ' ', (string) $name));
    $n = preg_replace('/\s+[—–]\s+/u', ' - ', $n);
    return mb_substr($n, 0, 80);
}
function owner_open_line($target)
{
    $t = preg_replace('/[^a-z0-9:-]/', '', strtolower((string) $target));
    if ($t === '' || !function_exists('site_base_url')) {
        return '';
    }
    return "\n\nOpen in the back office: " . site_base_url() . '?open=' . $t;
}

/** A guest review submitted through the site, waiting for approval. */
function owner_note_review($guestName, $propName, $stars, $text)
{
    return [
        'subject' => 'New ' . (int) $stars . "\u{2605} review for " . $propName . ' — approve?',
        'text' =>
            'A review was submitted by ' . owner_name($guestName) . ' for ' . $propName . ' (' . (int) $stars . "\u{2605}):\n\n" .
            owner_quote($text) .
            "\n\nApprove or decline it in Manage \u{2192} Guest reviews." .
            owner_open_line('moderation'),
    ];
}

/** A review left through the direct review LINK, which also carries contact details. */
function owner_note_lead($name, $propName, $stars, $text, $email, $phone = '')
{
    return [
        'subject' => 'New ' . (int) $stars . "\u{2605} review for " . $propName . ' via your link — approve?',
        'text' =>
            owner_name($name) . ' left a ' . (int) $stars . "\u{2605} review for " . $propName . " via the review link:\n\n" .
            owner_quote($text) .
            "\n\nContact: " . $email . ($phone ? ' / ' . $phone : '') .
            "\n\nApprove it (and privately rate the guest) in Manage \u{2192} Guest reviews." .
            owner_open_line('moderation'),
    ];
}

/** A guest's suggestion for the things-to-do list. */
function owner_note_experience($guestName, $title, $body, $linkUrl = '', $phone = '')
{
    return [
        'subject' => 'New suggestion: “' . email_snip($title, 50) . '”',
        'text' =>
            (owner_name($guestName) ?: 'A guest') . " suggested an experience:\n\n" .
            owner_quote($title) . "\n\n" . owner_quote($body) . "\n\n" .
            ($linkUrl ? 'Link: ' . $linkUrl . "\n" : '') .
            ($phone ? 'Phone: ' . $phone . "\n" : '') .
            "\nReview it in Manage \u{2192} Experiences." .
            owner_open_line('settings:experiences'),
    ];
}

/** A push that reached NO device, so the alert falls back to email. $open is the
 * push's own ?open= target, so the email lands where the notification would have. */
function owner_note_push_fallback($title, $body, $open = '')
{
    return [
        'subject' => $title,
        'text' =>
            trim((string) $body) .
            "\n\n(Sent by email because no device is currently receiving alerts \u{2014} " .
            "check Manage \u{2192} Notifications.)" .
            owner_open_line($open),
    ];
}

/**
 * The owner's own "does email work at all" test, from Manage → System check. This one
 * builds its own HTML rather than leaning on owner_alert_text_html, because the branded
 * shell IS the point: the email doubles as a live preview of what guests receive.
 */
function owner_mail_test_body()
{
    return [
        'subject' => 'Cottage Holidays Blakeney — test email',
        'text' => "This is a test email from your System check. If you're reading this, outgoing email works.",
        'html' => email_shell(
            'Test email',
            email_h('It works! 🎉') .
                email_p('This is a test email from your System check — outgoing email is set up correctly.') .
                email_p('This is exactly how your emails look to guests.', true),
        ),
    ];
}

// ---- The rest of the app's emails, as PURE builders -------------------------
// Same reason as the owner notes above: these composed inline in a route or a cron
// script, so nothing could preview or render them. Each takes its facts as arguments
// and returns ['subject','text','html'] — no DB, no SMTP, no globals.

/** The one-time code that finishes an owner sign-in on a new device. */
/**
 * A back-office sign-in code, to the person signing in and nobody else.
 * 'device' — a new phone or computer, after the password (10 minutes).
 * 'signin' — the email-first path: the code alone signs in (10 minutes).
 * 'email'  — confirming a new sign-in address before it changes (30 minutes).
 */
// $url (sign-in codes only): a one-tap link that carries the code, like a guest's
// code email has — the code screen promises one. It signs in the device that opens
// it. A new-device code has its OWN title and subject: it can land minutes after a
// sign-in code, and two emails both called "Your sign-in code" invite typing the
// wrong one.
function admin_code_body($code, $purpose = 'device', $first = '', $url = '')
{
    $mins = $purpose === 'email' ? 30 : 10;
    $leads = [
        'device' => 'Use this code to finish signing in to the back office on a new device.',
        'signin' => 'Use this code to sign in to the back office.',
        'email' => 'Use this code to make this your sign-in email for the back office.',
    ];
    $lead = $leads[$purpose] ?? $leads['device'];
    $title = ['email' => 'Confirm your new email', 'signin' => 'Your sign-in code'][$purpose] ?? 'Your code for a new device';
    $pre = ['email' => 'Your code to confirm the new address', 'signin' => 'Your one-time sign-in code'][$purpose] ?? 'A code to finish signing in on a new device';
    $url = $purpose === 'signin' ? (string) $url : '';
    $first = trim((string) $first);
    $hello = $first !== '' ? 'Hello ' . $first . ",\n\n" : '';
    // A device code means someone had the password; a sign-in code only that someone
    // typed this address, and nobody gets in without the code.
    $ignore = [
        'email' => 'If you didn’t just change your email, ignore this one: nothing changes until the code is used.',
        'signin' => 'If you didn’t just try to sign in, ignore this email: nobody can sign in without the code.',
    ][$purpose] ?? 'If you didn’t just try to sign in, ignore this email and consider changing your password.';
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    return [
        'subject' => $title . ' — Cottage Holidays Blakeney',
        'text' => $hello . $lead . "\n\n" . 'Your code: ' . $code . "\n\n" . ($url !== '' ? "Or tap this link to sign in on this device:\n" . $url . "\n\n" : '') . 'It expires in ' . $mins . ' minutes. ' . $ignore,
        'html' => email_shell(
            $pre,
            email_h($title) .
                ($first !== '' ? email_p('Hello ' . $esc($first) . ',') : '') .
                email_lead($esc($lead)) .
                email_code('Your code', $code, 'Expires in ' . $mins . ' minutes.') .
                ($url !== ''
                    ? email_btn2($url, 'Or sign in on this device') .
                        email_footnote('Copy this link into your browser if the button doesn&rsquo;t work:<br><a href="' . $esc($url) . '" style="color:' . email_accent_ink() . ';text-decoration:underline;word-break:break-all;">' . $esc($url) . '</a>')
                    : '') .
                email_footnote($esc($ignore)),
        ),
    ];
}

/**
 * An invite to the back office: a link to choose their own password. Nobody else
 * ever sets or sees it — the owner included — so the email says so.
 */
function admin_invite_body($first, $byFirst, $username, $url)
{
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $by = trim((string) $byFirst) !== '' ? trim((string) $byFirst) : 'The owner';
    $first = trim((string) $first) !== '' ? trim((string) $first) : 'there';
    return [
        'subject' => $by . ' has given you a sign-in — Cottage Holidays Blakeney',
        'text' =>
            "Hello {$first},\n\n" .
            "{$by} has given you a sign-in to the Cottage Holidays Blakeney back office. Choose your password to finish:\n" .
            $url . "\n\n" .
            "Your username is {$username}.\n" .
            "The link works once, for 7 days. Only you will know the password you choose.\n\n" .
            'Cottage Holidays Blakeney',
        'html' => email_shell(
            'Choose your password to finish — the link works once, for 7 days',
            email_h('Choose your password') .
                email_p('Hello ' . $esc($first) . ',') .
                email_lead($esc($by) . ' has given you a sign-in to the Cottage Holidays Blakeney back office.') .
                email_btn($url, 'Choose your password') .
                email_rows([['Your username', '<b>' . $esc($username) . '</b>']]) .
                email_footnote(
                    'Button not working, or reading this on another device? Copy this link into your browser:<br>' .
                        '<a href="' . $esc($url) . '" style="color:' . email_accent_ink() . ';text-decoration:underline;word-break:break-all;">' . $esc($url) . '</a>',
                ) .
                email_footnote('The link works once, for 7 days. Only you will know the password you choose — ' . $esc($by === 'The owner' ? 'the owner' : $by) . ' included.'),
        ),
    ];
}

/**
 * A link to choose a new back-office password: asked for from the sign-in page,
 * or sent by the owner from People & access. Saving it signs out every other
 * session, which the email says before the person taps.
 */
function admin_reset_body($first, $username, $url, $byFirst = '')
{
    $esc = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
    $first = trim((string) $first) !== '' ? trim((string) $first) : 'there';
    $by = trim((string) $byFirst);
    $why = $by !== '' ? $by . ' sent you this link.' : 'You asked to reset your back-office password.';
    return [
        'subject' => 'Choose a new password — Cottage Holidays Blakeney',
        'text' =>
            "Hello {$first},\n\n" .
            $why . " Choose a new password for {$username} here:\n" .
            $url . "\n\n" .
            "Saving it signs you out on your other devices. The link works once and expires in 30 minutes.\n" .
            "If you didn't ask for this, ignore it: your password hasn't changed.\n\n" .
            'Cottage Holidays Blakeney',
        'html' => email_shell(
            'Choose a new password — the link works once, for 30 minutes',
            email_h('Choose a new password') .
                email_p('Hello ' . $esc($first) . ',') .
                email_lead($esc($why) . ' Saving a new password signs you out on your other devices.') .
                email_btn($url, 'Choose a new password') .
                email_rows([['Your username', '<b>' . $esc($username) . '</b>']]) .
                email_footnote(
                    'Button not working, or reading this on another device? Copy this link into your browser:<br>' .
                        '<a href="' . $esc($url) . '" style="color:' . email_accent_ink() . ';text-decoration:underline;word-break:break-all;">' . $esc($url) . '</a>',
                ) .
                email_footnote('The link works once and expires in 30 minutes. If you didn&rsquo;t ask for this, ignore it: your password hasn&rsquo;t changed.'),
        ),
    ];
}

/** The weekly database backup, whose .sql.gz rides as an attachment. */
function backup_report_body($sizeLabel, $filesNote = '')
{
    return [
        'subject' => 'Weekly database backup — Cottage Holidays Blakeney',
        'text' =>
            "Attached is this week's database backup (" . $sizeLabel . ").\n\n" .
            'Keep a few of these somewhere safe (they contain all bookings, payments and guest details). ' .
            "To restore, unzip and import the .sql via your host's phpMyAdmin." .
            ($filesNote ? "\n\n" . $filesNote : ''),
        'html' => email_shell(
            'Weekly database backup',
            email_h('Weekly database backup') .
                email_p('Attached is this week&rsquo;s database backup (' . email_esc($sizeLabel) . ').') .
                email_p(
                    'Keep a few of these somewhere safe — they contain all bookings, payments and guest details. ' .
                        'To restore, unzip and import the .sql via your host&rsquo;s phpMyAdmin.',
                    !$filesNote,
                ) .
                ($filesNote ? email_p(email_esc($filesNote), true) : ''),
        ),
    ];
}

/**
 * The guest's copy of a chat reply — the message quoted, with the photo one tap away.
 * `$replyable` is whether a reply-to address exists, which changes only the sentence
 * about how to answer.
 */
function guest_chat_body($guestName, $message, $photoUrl = '', $replyable = false)
{
    $who = $guestName ?: 'there';
    $reply = 'Reply on our website chat' . ($replyable ? ' — or just reply to this email' : '') . '.';
    return [
        'subject' => 'New message: “' . email_snip($message, 50) . '”',
        'text' =>
            'Hello ' . $who . ",\n\nYou have a new message from Cottage Holidays Blakeney:\n\n\"" .
            $message . '"' .
            ($photoUrl !== '' ? "\n\nView photo: " . $photoUrl : '') .
            "\n\n" . $reply . "\nCottage Holidays Blakeney",
        'html' => email_shell(
            'A message from Cottage Holidays Blakeney',
            email_h('You have a new message') .
                email_p('Hello ' . email_esc($who) . ',') .
                email_p('&ldquo;' . nl2br(email_esc($message)) . '&rdquo;') .
                ($photoUrl !== ''
                    ? email_p(
                        '<a href="' . email_esc($photoUrl) . '" style="color:' . email_accent_ink() .
                            ';text-decoration:underline;">View the photo</a>',
                    )
                    : '') .
                email_p(
                    'Reply on our website chat' .
                        ($replyable ? ' &mdash; or just reply to this email' : '') . '.',
                    true,
                ),
        ),
    ];
}

/** The owner's heads-up that a guest answered a chat BY EMAIL. Plain text by design. */
function owner_note_chat_reply($guestName, $guestEmail, $message, $replyable = false, $subjTag = '')
{
    return [
        'subject' => (owner_name($guestName) ?: 'A guest') . ' replied: “' . email_snip($message, 50) . '”' . $subjTag,
        'text' =>
            "A guest has replied by email to a website chat.\n\nFrom: " .
            (owner_name($guestName) ?: '—') . ' (' . ($guestEmail ?: 'no email') . ")\n\n" .
            owner_quote($message) . "\n" .
            ($replyable ? "\nJust reply to this email and they get it on the website and by email." : '') .
            "\nOr open the back office → Guest messages to reply." .
            owner_open_line('inbox:messages'),
    ];
}

/** The owner sending a chat message FROM the back office, as the guest receives it. */
function guest_message_body($guestName, $message)
{
    $who = $guestName ?: 'there';
    return [
        'subject' => 'Cottage Holidays Blakeney',
        'text' => 'Hello ' . $who . ",\n\n" . $message . "\n\nCottage Holidays Blakeney",
        'html' => email_shell(
            'A message from Cottage Holidays Blakeney',
            email_h('A message for you') .
                email_p('Hello ' . email_esc($who) . ',') .
                email_p(nl2br(email_esc($message))) .
                email_p('Reply any time on our website chat.', true),
        ),
    ];
}

/**
 * The owner's heads-up that a guest started a chat on the WEBSITE. Sibling of
 * owner_note_chat_reply, which is the same news arriving by email instead — two
 * different facts, so deliberately two composers rather than one with a flag.
 */
function owner_note_chat_new($guestName, $guestEmail, $message, $replyable = false, $subjTag = '')
{
    return [
        'subject' => (owner_name($guestName) ?: 'Someone') . ': “' . email_snip($message, 50) . '”' . $subjTag,
        'text' =>
            "Someone has sent you a message via the website chat.\n\nFrom: " .
            (owner_name($guestName) ?: '—') . ' (' . ($guestEmail ?: 'no email') . ")\n\n" .
            owner_quote($message) . "\n" .
            ($replyable ? "\nJust reply to this email and the guest gets it on the website and by email." : '') .
            "\nOr open the back office → Guest messages to reply." .
            owner_open_line('inbox:messages'),
    ];
}

/**
 * The follow-up to an enquiry that went quiet. `$datesGone` is the honest half: the
 * email may only claim a hold while the dates really are free.
 */
function enquiry_nudge_body($name, $propName, $dateSpan, $link, $accent, $datesGone = false)
{
    $holdLine = $datesGone
        ? "Those exact dates have since been booked, but we'd love to help you find another stay that suits."
        : "We're still holding those dates for you.";
    $cta = $datesGone ? 'See available dates' : 'Pick up where you left off';
    $close =
        "Or just reply to this email (or message us on the website) and we'll " .
        ($datesGone ? 'happily sort out an alternative.' : 'get your booking confirmed.');
    return [
        // THE ANSWER IN THE SUBJECT: whether the dates are still there is the whole
        // reason to open it.
        'subject' => $datesGone
            ? 'Your dates have gone — let’s find another stay at ' . $propName
            : 'Still thinking about ' . $propName . '? Those dates are still free',
        'text' =>
            'Hello ' . $name . ",\n\nThanks for your enquiry about " . $propName . ' for ' . $dateSpan . ".\n\n" .
            $holdLine . ' ' .
            ($link
                ? ($datesGone ? "You can see what's free here:\n" : "You can pick up where you left off here:\n") .
                    $link . "\n\n"
                : '') .
            $close . "\n\nWarm wishes,\nCottage Holidays Blakeney",
        'html' => email_shell(
            $datesGone ? 'See what’s free instead — it takes a minute.' : 'Pick up where you left off — your details are saved.',
            email_h('Still thinking it over?') .
                email_p(
                    'Hello ' . email_esc($name) . ', thanks for your enquiry about <strong style="color:#1B2A34;">' .
                        email_esc($propName) . '</strong> for ' . email_esc($dateSpan) . '.',
                ) .
                email_p(email_esc($holdLine)) .
                // THE BUTTON KEEPS THE HOUSE ACCENT, not the cottage's. These two were
                // the only templates handing a per-cottage colour to email_btn, and a
                // button carries WORDS: white on Jollyboat's green measured 3.30:1 and
                // even the design system's dark ink only reaches 4.00:1, both under AA.
                // The house accent+ink pair is the measured-safe one every other
                // template uses. The cottage colour stays where it is a FILL — the
                // shell's bar and email_h's swatch, which carry no text.
                ($link ? email_btn($link, $cta) : '') .
                email_p(email_esc($close), true),
            $accent,
        ),
    ];
}

/** The rescue for an enquiry FORM abandoned part-way — a draft, not a sent enquiry. */
function enquiry_rescue_body($name, $propName, $dateSpan, $link, $accent)
{
    $span = $dateSpan !== '' ? ' for ' . $dateSpan : '';
    return [
        'subject' => 'Nearly there: finish your ' . $propName . ' enquiry',
        'text' =>
            'Hello ' . $name . ",\n\nIt looks like you were part-way through an enquiry about " . $propName . $span .
            " and didn't quite finish. No pressure at all — if you'd still like to stay, " .
            "you can pick up where you left off here:\n" .
            ($link ? $link . "\n\n" : "\n") .
            'If you open it on the same device you started on, we\'ll have kept what you typed. ' .
            "Or just reply to this email and we'll happily sort it out for you.\n\n" .
            "Warm wishes,\nCottage Holidays Blakeney",
        'html' => email_shell(
            'One tap picks it up where you left off.',
            email_h('Finish your enquiry?') .
                email_p(
                    'Hello ' . email_esc($name) .
                        ', it looks like you were part-way through an enquiry about <strong style="color:#1B2A34;">' .
                        email_esc($propName) . '</strong>' . email_esc($span) . " and didn't quite finish.",
                ) .
                email_p(
                    "No pressure at all — if you'd still like to stay, you can pick up where you left off in one tap. " .
                        'If you open it on the same device you started on, we\'ll have kept what you typed.',
                ) .
                ($link ? email_btn($link, 'Pick up where you left off') : '') .
                email_p("Or just reply to this email and we'll happily sort it out for you.", true),
            $accent,
        ),
    ];
}

/**
 * The owner's own reply from Manage → Email. Blank lines split paragraphs, exactly as
 * `owner_alert_text_html` does for the plain notes — the owner types prose, not markup.
 */
function mailbox_reply_body($subject, $bodyText)
{
    $inner = '';
    foreach (array_filter(array_map('trim', preg_split('/\n{2,}/', (string) $bodyText))) as $para) {
        $inner .= email_p(nl2br(email_esc($para)));
    }
    return [
        'subject' => $subject,
        'text' => $bodyText,
        'html' => email_shell($subject, $inner),
    ];
}

/**
 * One subscriber's copy of the newsletter. The unsubscribe link is PER RECIPIENT (their
 * own token), so this is built inside the send loop rather than once — and it rides
 * `email_shell`'s footer options so the link is in the document as well as the RFC 8058
 * headers. `$bodyHtml` is PRE-ESCAPED owner-authored HTML, like every email_p caller.
 */
function newsletter_body($subject, $bodyText, $bodyHtml, $unsubUrl)
{
    $foot = "You're receiving this because you signed up at Cottage Holidays Blakeney.";
    return [
        'subject' => $subject,
        'text' => $bodyText . "\n\n—\n" . $foot . "\nUnsubscribe: " . $unsubUrl,
        'html' => email_shell($subject, email_p($bodyHtml), '#C6885E', [
            'unsubscribe' => $unsubUrl,
            'footer' => $foot,
        ]),
    ];
}

/**
 * The weekly ANALYTICS email. Composed at script level from ~11 live figures, which is
 * why it stayed inline while the other thirteen were extracted — the payload IS the
 * work. It gets one now, so email-samples.php can preview it and the render gate can
 * prove it builds and that every colour in it clears AA. `?force=1` (Manage → System
 * check → More tools) still sends the REAL email with REAL data, which beats a fixture;
 * this is about the template never shipping broken.
 */
function weekly_analytics_body($d)
{
    // The same figures as Manage → Analytics: PEOPLE (by device and connection),
    // pages viewed, enquiries SENT from the site (the event — the enquiries table
    // loses every approved one) and bookings made THROUGH the site. The old email
    // divided every booking, hand-added ones too, by visitors and called it
    // conversion.
    $people = (int) ($d['uniq'] ?? 0);
    $views = (int) ($d['views'] ?? 0);
    $sent = (int) ($d['sent'] ?? ($d['enquiries'] ?? 0));
    $booked = (int) ($d['booked'] ?? 0);
    $plural = fn($n, $one, $many) => $n . ' ' . ($n === 1 ? $one : $many);
    $subject =
        'Your Blakeney week online: ' .
        $plural($people, 'person', 'people') .
        ($d['deltaTxt'] !== '' ? ' (' . $d['deltaTxt'] . ')' : '') .
        ', ' .
        $plural($sent, 'enquiry', 'enquiries');

    $text =
        "Good evening,\n\n" .
        "Here's how Cottage Holidays Blakeney did online this week.\n\n" .
        "  • People: {$people}" .
        ($d['deltaTxt'] !== '' ? " ({$d['deltaTxt']} on last week)" : '') .
        "\n" .
        "  • Pages viewed: {$views}\n" .
        '  • Enquiries sent: ' . $sent . "\n" .
        '  • Booked through the site: ' . $booked . "\n" .
        "  • Top source: {$d['topChannel']}\n" .
        "  • Most-viewed page: {$d['topPage']}\n" .
        ($d['noResult'] > 0 ? "  • Date searches that found nothing free: {$d['noResult']}\n" : '') .
        ($d['dropPct'] !== null && $d['dropPct'] <= -30 ? "\nHeads-up: " . abs($d['dropPct']) . "% fewer people than last week.\n" : '') .
        "\nSee the full picture in Manage → Analytics.\n\nyour website";

    // ---- HTML ----
    $alertHtml =
        $d['dropPct'] !== null && $d['dropPct'] <= -30
            ? email_note(
                '<strong>Heads-up:</strong> ' .
                    abs($d['dropPct']) .
                    '% fewer people than last week. Worth a look — refresh a listing photo, post an update, or check your search rankings.',
                '#FFA726',
            )
            : '';

    $inner =
        email_h('Your week online', '#C6885E') .
        email_p(email_esc(date('l j F Y')), true) .
        $alertHtml .
        email_amount(
            'People this week',
            $people . ($d['deltaTxt'] !== '' ? ' <span style="font-size:15px;color:' . email_muted_ink() . ';">' . $d['deltaTxt'] . '</span>' : ''),
            $plural($views, 'page', 'pages') . ' viewed',
        ) .
        email_rows(
            [
                ['Enquiries sent', (string) $sent],
                ['Booked through the site', (string) $booked],
                ['Top source', email_esc($d['topChannel'])],
                ['Most-viewed page', email_esc($d['topPage'])],
            ] + ($d['noResult'] > 0 ? [4 => ['Searches finding nothing free', (string) $d['noResult']]] : []),
        ) .
        email_btn($d['siteUrl'], 'Open analytics') .
        email_p('You can switch this weekly email off in Manage.', true);
    return ['subject' => $subject, 'text' => $text, 'html' => email_shell('Your Blakeney week online', $inner, '#C6885E')];
}

/**
 * The weekly OWNER DIGEST. Like weekly_analytics_body, it composed at script level from
 * a dozen live figures — the payload is the work, which is why it outlasted the other
 * thirteen. The four pure FORMATTERS move in here with the template (they format, they
 * do not query); everything that touches the database stays in the cron script.
 * `?force=1` still sends the real thing with real data; this is so the template can be
 * previewed and can never ship broken.
 */
function owner_digest_body($d)
{
    $money = fn($n) => '£' . number_format((float) $n, 2);
    $nameOf = fn($k) => prop_display($k)['name'];
    $pretty = fn($dt) => date('D j M', strtotime($dt));
    $accentOf = fn($k) => prop_display($k)['accent'];
    // A COPY WITHOUT THE MONEY for someone without Money overview: no figures, no
    // balances, and no list of warnings (their free text can carry an amount).
    $plain = !empty($d['noMoney']);
    // THE THREE NUMBERS THAT DECIDE THE WEEK, with the one thing that needs doing named
    // first when there is one — read on a Monday-morning lock screen.
    $attn = is_array($d['actAttention'] ?? null) ? count($d['actAttention']) : 0;
    $subject =
        'Week ahead: ' .
        count((array) ($d['arrivals'] ?? [])) . ' arrival' . (count((array) ($d['arrivals'] ?? [])) === 1 ? '' : 's') .
        (!$plain && (float) ($d['owedSum'] ?? 0) > 0.005 ? ', ' . $money($d['owedSum']) . ' to collect' : '') .
        ', ' . $d['newBookings'] . ' new booking' . ($d['newBookings'] === 1 ? '' : 's') .
        ($attn > 0 ? ' — ' . $attn . ' to fix' : '');

    $arrivalsTxt = $d['arrivals']
        ? implode(
            "\n",
            array_map(
                fn($a) => '  • ' . $pretty($a['check_in']) . ' — ' . $a['name'] . ' (' . $nameOf($a['prop_key']) . ')',
                $d['arrivals'],
            ),
        )
        : '  • No arrivals in the next 7 days.';

    $text =
        "Good morning,\n\n" .
        "Here's how Cottage Holidays Blakeney is looking.\n\n" .
        "THE WEEK JUST GONE\n" .
        "  • New bookings: {$d['newBookings']}" .
        ($plain ? "\n\n" : ' (' . $money($d['newValue']) . " of stays)\n" . '  • Money received: ' . $money($d['received']) . "\n\n") .
        "THE WEEK AHEAD — arrivals\n{$arrivalsTxt}\n\n" .
        "TO KEEP AN EYE ON\n" .
        ($plain ? '' : "  • Balances owed: {$d['owedCount']} booking" . ($d['owedCount'] === 1 ? '' : 's') . ' (' . $money($d['owedSum']) . ")\n") .
        "  • Pending enquiries: {$d['pending']}\n" .
        ($d['occPct'] !== null ? "  • Occupancy (next 30 days): {$d['occPct']}%\n" : '') .
        "\nACTIVITY THIS WEEK\n" .
        "  • {$d['actTotal']} logged event" .
        ($d['actTotal'] === 1 ? '' : 's') .
        "\n" .
        ($plain
            ? ''
            : (count($d['actAttention'])
                ? "  • Needs attention:\n" . implode("\n", array_map(fn($a) => '     - ' . $a['summary'], $d['actAttention'])) . "\n"
                : "  • Nothing needs your attention.\n")) .
        (count($d['misses'])
            ? "\nTEACH YOUR ASSISTANT\n  • " .
                count($d['misses']) .
                ' search' .
                (count($d['misses']) === 1 ? '' : 'es') .
                " found nothing this week:\n" .
                implode(
                    "\n",
                    array_map(fn($m) => '     - "' . $m['t'] . '"' . ($m['n'] > 1 ? " (asked {$m['n']} times)" : ''), $d['misses']),
                ) .
                "\n  • Open Search and type \"teach the assistant\" — each fix takes one tap.\n"
            : '') .
        "\nHave a good week,\nyour website";

    $sectionLabel = fn($t) => email_caption($t);
    $arrivalsHtml = $d['arrivals']
        ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;">' .
            implode(
                '',
                array_map(
                    fn($a) => '<tr><td style="padding:7px 0;border-bottom:1px solid #E2E3E3;font-family:' .
                        email_sans() .
                        ';font-size:15px;color:#1B2A34;">' .
                        '<span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:' .
                        $accentOf($a['prop_key']) .
                        ';margin-right:9px;"></span>' .
                        htmlspecialchars($pretty($a['check_in'])) .
                        ' — <strong style="color:#1B2A34;">' .
                        htmlspecialchars($a['name']) .
                        '</strong> · ' .
                        htmlspecialchars($nameOf($a['prop_key'])) .
                        '</td></tr>',
                    $d['arrivals'],
                ),
            ) .
            '</table>'
        : email_p('No arrivals in the next 7 days.', true);

    $inner =
        email_h('Your week at a glance', '#C6885E') .
        email_p(htmlspecialchars(date('l j F Y')), true) .
        $sectionLabel('The week just gone') .
        email_rows(
            $plain
                ? [['New bookings', (string) $d['newBookings']]]
                : [
                    ['New bookings', $d['newBookings'] . ' <span style="color:' . email_muted_ink() . ';">(' . $money($d['newValue']) . ')</span>'],
                    ['Money received', $money($d['received'])],
                ],
        ) .
        $sectionLabel('The week ahead — arrivals') .
        $arrivalsHtml .
        $sectionLabel('To keep an eye on') .
        email_rows(
            array_filter([
                $plain ? null : ['Balances owed', $d['owedCount'] . ' <span style="color:' . email_muted_ink() . ';">(' . $money($d['owedSum']) . ')</span>'],
                ['Pending enquiries', (string) $d['pending']],
                $d['occPct'] !== null ? ['Occupancy (next 30 days)', $d['occPct'] . '%'] : null,
            ]),
        ) .
        $sectionLabel('Activity this week') .
        email_rows([['Logged events', (string) $d['actTotal']]]) .
        ($plain
            ? ''
            : (count($d['actAttention'])
            ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0;">' .
                implode(
                    '',
                    array_map(
                        fn($a) => '<tr><td style="padding:6px 0;border-bottom:1px solid #E2E3E3;font-family:' .
                            email_sans() .
                            ';font-size:15px;color:#1B2A34;">' . email_cap($a['severity'] === 'action' ? 'bad' : 'warn', $a['severity'] === 'action' ? 'Needs you' : 'Worth a look') . '&nbsp; ' .
                            htmlspecialchars($a['summary']) .
                            '</td></tr>',
                        $d['actAttention'],
                    ),
                ) .
                '</table>'
            : email_p('Nothing needs your attention.', true))) .
        (count($d['misses'])
            ? $sectionLabel('Teach your assistant') .
                email_p(
                    count($d['misses']) .
                        ' search' .
                        (count($d['misses']) === 1 ? '' : 'es') .
                        ' found nothing this week — open Search and type <strong>"teach the assistant"</strong>; each fix takes one tap.',
                    true,
                ) .
                '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0;">' .
                implode(
                    '',
                    array_map(
                        fn($m) => '<tr><td style="padding:6px 0;border-bottom:1px solid #E2E3E3;font-family:' .
                            email_sans() .
                            ';font-size:13px;color:#1B2A34;">“' .
                            htmlspecialchars($m['t']) .
                            '”' .
                            ($m['n'] > 1 ? ' <span style="color:' . email_muted_ink() . ';">· asked ' . $m['n'] . ' times</span>' : '') .
                            '</td></tr>',
                        $d['misses'],
                    ),
                ) .
                '</table>'
            : '') .
        // Like every alert to the owner, it ends where they act: today's screen.
        (!empty($d['openUrl']) ? email_btn((string) $d['openUrl'], 'Open the back office') : '') .
        email_p('Have a good week.', true);
    return ['subject' => $subject, 'text' => $text, 'html' => email_shell('Your Blakeney week at a glance', $inner, '#C6885E')];
}
